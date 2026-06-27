import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, forkJoin, from, of } from 'rxjs';
import { map, switchMap, catchError, tap } from 'rxjs/operators';

export interface WeatherStation {
  point_id: number;
  station_abbr: string;
  point_name: string;
  point_type_en: string;
  point_height_masl: number;
  lat: number;
  lon: number;
  distanceKm?: number;
}

export interface HourlyForecast {
  datetime: Date;
  temperature?: number;
  precipitation?: number;
  windSpeed?: number;
  windGust?: number;
  precipProb?: number;
  sunshine?: number;
  cloudCoverLow?: number;
  cloudCoverMid?: number;
  cloudCoverHigh?: number;
  weatherIcon?: number;
}

export interface DailyForecast {
  date: Date;
  tempMin?: number;
  tempMax?: number;
  precipTotal?: number;
  weatherIcon?: number;
}

export interface StationForecast {
  station: WeatherStation;
  hourly: HourlyForecast[];
  daily: DailyForecast[];
  fetchedAt: Date;
}

const STAC_BASE = 'https://data.geo.admin.ch';
const COLLECTION = 'ch.meteoschweiz.ogd-local-forecasting';
const META_POINTS_URL = `${STAC_BASE}/${COLLECTION}/ogd-local-forecasting_meta_point.csv`;

// Key parameters to fetch (one CSV per parameter, containing all points)
const HOURLY_PARAMS = ['tre200h0', 'rre150h0', 'fu3010h0', 'fu3010h1', 'rp0003i0', 'sre000h0', 'jww003i0', 'nprolohs'];
const DAILY_PARAMS  = ['tre200pn', 'tre200px', 'rka150p0', 'jp2000d0'];

@Injectable({ providedIn: 'root' })
export class WeatherService {
  private http = inject(HttpClient);

  private stationsCache: WeatherStation[] | null = null;
  private latestItemId: string | null = null;
  private forecastCache = new Map<string, StationForecast>();

  /** Load the station list from MeteoSwiss open data */
  getStations(): Observable<WeatherStation[]> {
    if (this.stationsCache) return of(this.stationsCache);

    return this.http.get(META_POINTS_URL, { responseType: 'text' }).pipe(
      map(csv => this.parseStationsCsv(csv)),
      tap(stations => this.stationsCache = stations),
      catchError(err => {
        console.error('Failed to load stations:', err);
        return of([]);
      })
    );
  }

  /** Find stations near a WGS84 coordinate, sorted by distance */
  getNearbyStations(lat: number, lon: number, maxCount = 5, maxDistanceKm = 80): Observable<WeatherStation[]> {
    return this.getStations().pipe(
      map(stations => {
        const withDist = stations.map(s => ({
          ...s,
          distanceKm: this.haversineKm(lat, lon, s.lat, s.lon)
        }));
        return withDist
          .filter(s => s.distanceKm! <= maxDistanceKm)
          .sort((a, b) => a.distanceKm! - b.distanceKm!)
          .slice(0, maxCount);
      })
    );
  }

  /** Fetch forecast for a set of stations */
  getForecastsForStations(stations: WeatherStation[]): Observable<StationForecast[]> {
    if (stations.length === 0) return of([]);

    return this.getLatestItemId().pipe(
      switchMap(itemId => {
        if (!itemId) return of(stations.map(s => ({ station: s, hourly: [], daily: [], fetchedAt: new Date() })));

        const pointIds = new Set(stations.map(s => s.point_id));

        // Fetch all parameters in parallel
        const hourlyFetches = HOURLY_PARAMS.map(param => this.fetchParam(itemId, param));
        const dailyFetches  = DAILY_PARAMS.map(param => this.fetchParam(itemId, param));

        return forkJoin([...hourlyFetches, ...dailyFetches]).pipe(
          map(results => {
            const hourlyResults = results.slice(0, HOURLY_PARAMS.length);
            const dailyResults  = results.slice(HOURLY_PARAMS.length);

            return stations.map(station => {
              const hourly = this.mergeHourlyData(station.point_id, HOURLY_PARAMS, hourlyResults);
              const daily  = this.mergeDailyData(station.point_id, DAILY_PARAMS, dailyResults);
              return { station, hourly, daily, fetchedAt: new Date() };
            });
          })
        );
      })
    );
  }

  private getLatestItemId(): Observable<string | null> {
    if (this.latestItemId) return of(this.latestItemId);

    return this.http.get<any>(`${STAC_BASE}/api/stac/v1/collections/${COLLECTION}/items?limit=1`).pipe(
      map(res => {
        const id = res?.features?.[0]?.id ?? null;
        this.latestItemId = id;
        return id;
      }),
      catchError(err => {
        console.error('Failed to get latest item:', err);
        return of(null);
      })
    );
  }

  private fetchParam(itemId: string, param: string): Observable<Map<number, Map<string, number>>> {
    // Build URL: base/collection/itemId/filename.csv
    // We need to find the asset that matches the param name
    // Convention: assets are named like "vnut12.lssw.YYYYMMDDHHII.<param>.csv"
    // We derive the URL pattern from itemId (format: YYYYMMDD-ch)
    const date = itemId.replace('-ch', '');
    const url = `${STAC_BASE}/${COLLECTION}/${itemId}/vnut12.lssw.${date}0000.${param}.csv`;

    return this.http.get(url, { responseType: 'text' }).pipe(
      map(csv => this.parseParamCsv(csv)),
      catchError(err => {
        // Try fetching the item to get the actual asset URL
        return this.getAssetUrl(itemId, param).pipe(
          switchMap(assetUrl => {
            if (!assetUrl) return of(new Map<number, Map<string, number>>());
            return this.http.get(assetUrl, { responseType: 'text' }).pipe(
              map(csv => this.parseParamCsv(csv)),
              catchError(() => of(new Map<number, Map<string, number>>()))
            );
          })
        );
      })
    );
  }

  private assetUrlCache = new Map<string, string | null>();

  private getAssetUrl(itemId: string, param: string): Observable<string | null> {
    const cacheKey = `${itemId}:${param}`;
    if (this.assetUrlCache.has(cacheKey)) return of(this.assetUrlCache.get(cacheKey)!);

    return this.http.get<any>(`${STAC_BASE}/api/stac/v1/collections/${COLLECTION}/items/${itemId}`).pipe(
      map(item => {
        const assets = item?.assets ?? {};
        const key = Object.keys(assets).find(k => k.includes(`.${param}.csv`));
        const url = key ? assets[key].href : null;
        this.assetUrlCache.set(cacheKey, url);
        return url;
      }),
      catchError(() => of(null))
    );
  }

  /** Parse station CSV → WeatherStation[] */
  private parseStationsCsv(csv: string): WeatherStation[] {
    const lines = csv.replace(/\r/g, '').split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];

    const header = lines[0].split(';');
    const idxId     = header.indexOf('point_id');
    const idxAbbr   = header.indexOf('station_abbr');
    const idxName   = header.indexOf('point_name');
    const idxType   = header.indexOf('point_type_en');
    const idxHeight = header.indexOf('point_height_masl');
    const idxLat    = header.indexOf('point_coordinates_wgs84_lat');
    const idxLon    = header.indexOf('point_coordinates_wgs84_lon');

    return lines.slice(1).map(line => {
      const cols = line.split(';');
      return {
        point_id:         parseInt(cols[idxId]?.trim() ?? '0'),
        station_abbr:     cols[idxAbbr]?.trim() ?? '',
        point_name:       cols[idxName]?.trim() ?? '',
        point_type_en:    cols[idxType]?.trim() ?? '',
        point_height_masl: parseFloat(cols[idxHeight]?.trim() ?? '0') || 0,
        lat:              parseFloat(cols[idxLat]?.trim() ?? '0') || 0,
        lon:              parseFloat(cols[idxLon]?.trim() ?? '0') || 0,
      };
    }).filter(s => s.point_id > 0 && s.lat !== 0 && s.lon !== 0);
  }

  /** Parse a parameter CSV → Map<pointId, Map<dateStr, value>> */
  private parseParamCsv(csv: string): Map<number, Map<string, number>> {
    const result = new Map<number, Map<string, number>>();
    const lines = csv.replace(/\r/g, '').split('\n').filter(l => l.trim());
    if (lines.length < 2) return result;

    const header = lines[0].split(';');
    const idxId   = header.indexOf('point_id');
    const idxDate = header.indexOf('Date');
    const idxVal  = header.length - 1; // last column is the value

    for (const line of lines.slice(1)) {
      const cols = line.split(';');
      const id  = parseInt(cols[idxId]?.trim() ?? '0');
      const dt  = cols[idxDate]?.trim() ?? '';
      const val = parseFloat(cols[idxVal]?.trim() ?? '');
      if (!id || !dt || isNaN(val)) continue;

      if (!result.has(id)) result.set(id, new Map());
      result.get(id)!.set(dt, val);
    }
    return result;
  }

  /** Merge multiple hourly param maps into HourlyForecast[] for a station */
  private mergeHourlyData(
    pointId: number,
    params: string[],
    data: Map<number, Map<string, number>>[]
  ): HourlyForecast[] {
    // Collect all timestamps from the first available param
    const allDates = new Set<string>();
    for (const d of data) {
      const stationData = d.get(pointId);
      if (stationData) stationData.forEach((_, k) => allDates.add(k));
    }

    const paramData: Record<string, Map<string, number>> = {};
    params.forEach((p, i) => {
      paramData[p] = data[i]?.get(pointId) ?? new Map();
    });

    const sorted = [...allDates].sort();
    return sorted.map(dt => {
      const date = this.parseMeteoDate(dt);
      const h: HourlyForecast = { datetime: date };
      if (paramData['tre200h0']?.has(dt)) h.temperature     = paramData['tre200h0'].get(dt);
      if (paramData['rre150h0']?.has(dt)) h.precipitation   = paramData['rre150h0'].get(dt);
      if (paramData['fu3010h0']?.has(dt)) h.windSpeed        = paramData['fu3010h0'].get(dt);
      if (paramData['fu3010h1']?.has(dt)) h.windGust         = paramData['fu3010h1'].get(dt);
      if (paramData['rp0003i0']?.has(dt)) h.precipProb       = paramData['rp0003i0'].get(dt);
      if (paramData['sre000h0']?.has(dt)) h.sunshine         = paramData['sre000h0'].get(dt);
      if (paramData['jww003i0']?.has(dt)) h.weatherIcon      = paramData['jww003i0'].get(dt);
      if (paramData['nprolohs']?.has(dt)) h.cloudCoverLow    = paramData['nprolohs'].get(dt);
      return h;
    });
  }

  /** Merge daily param maps into DailyForecast[] */
  private mergeDailyData(
    pointId: number,
    params: string[],
    data: Map<number, Map<string, number>>[]
  ): DailyForecast[] {
    const allDates = new Set<string>();
    for (const d of data) {
      const stationData = d.get(pointId);
      if (stationData) stationData.forEach((_, k) => allDates.add(k));
    }

    const paramData: Record<string, Map<string, number>> = {};
    params.forEach((p, i) => {
      paramData[p] = data[i]?.get(pointId) ?? new Map();
    });

    const sorted = [...allDates].sort();
    return sorted.map(dt => {
      const date = this.parseMeteoDate(dt);
      const d: DailyForecast = { date };
      if (paramData['tre200pn']?.has(dt)) d.tempMin      = paramData['tre200pn'].get(dt);
      if (paramData['tre200px']?.has(dt)) d.tempMax      = paramData['tre200px'].get(dt);
      if (paramData['rka150p0']?.has(dt)) d.precipTotal  = paramData['rka150p0'].get(dt);
      if (paramData['jp2000d0']?.has(dt)) d.weatherIcon  = paramData['jp2000d0'].get(dt);
      return d;
    });
  }

  /** Parse YYYYMMDDHHMM string to Date (UTC) */
  private parseMeteoDate(s: string): Date {
    const year  = parseInt(s.substring(0, 4));
    const month = parseInt(s.substring(4, 6)) - 1;
    const day   = parseInt(s.substring(6, 8));
    const hour  = parseInt(s.substring(8, 10)) || 0;
    const min   = parseInt(s.substring(10, 12)) || 0;
    return new Date(Date.UTC(year, month, day, hour, min));
  }

  /** Haversine distance in km */
  private haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  private deg2rad(d: number) { return d * Math.PI / 180; }

  /** Generate AI-ready text summary for a set of forecasts */
  generateAiText(forecasts: StationForecast[], clickedLat: number, clickedLon: number): string {
    const now = new Date();
    const lines: string[] = [
      `# Swiss Weather Forecast Report`,
      `Generated: ${now.toLocaleString('en-CH', { timeZone: 'Europe/Zurich' })}`,
      `Selected location: ${clickedLat.toFixed(4)}°N, ${clickedLon.toFixed(4)}°E`,
      `Source: MeteoSwiss Open Data (CC-BY)`,
      ``,
      `## Nearby Weather Stations (${forecasts.length})`,
      ``
    ];

    for (const fc of forecasts) {
      const s = fc.station;
      lines.push(`### ${s.point_name} (${s.station_abbr}) — ${s.distanceKm?.toFixed(1)} km away`);
      lines.push(`Elevation: ${s.point_height_masl} m a.s.l. | Type: ${s.point_type_en}`);
      lines.push(`Coordinates: ${s.lat.toFixed(4)}°N, ${s.lon.toFixed(4)}°E`);
      lines.push(``);

      // Next 48 hours hourly
      const next48h = fc.hourly
        .filter(h => h.datetime >= now)
        .slice(0, 48);

      if (next48h.length > 0) {
        lines.push(`#### Hourly Forecast (next 48 hours)`);
        lines.push(`| Time (local) | Temp (°C) | Precip (mm) | Wind (km/h) | Gust (km/h) | Precip% | Sunshine (min) |`);
        lines.push(`|---|---|---|---|---|---|---|`);

        for (const h of next48h) {
          const timeStr = h.datetime.toLocaleString('en-CH', {
            timeZone: 'Europe/Zurich',
            month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
          });
          lines.push(`| ${timeStr} | ${h.temperature?.toFixed(1) ?? '-'} | ${h.precipitation?.toFixed(1) ?? '-'} | ${h.windSpeed?.toFixed(0) ?? '-'} | ${h.windGust?.toFixed(0) ?? '-'} | ${h.precipProb?.toFixed(0) ?? '-'} | ${h.sunshine?.toFixed(0) ?? '-'} |`);
        }
        lines.push(``);
      }

      // Daily summary
      const futureDays = fc.daily
        .filter(d => {
          const dayStart = new Date(d.date);
          dayStart.setHours(0, 0, 0, 0);
          const todayStart = new Date(now);
          todayStart.setHours(0, 0, 0, 0);
          return dayStart >= todayStart;
        })
        .slice(0, 8);

      if (futureDays.length > 0) {
        lines.push(`#### Daily Summary (8-day)`);
        lines.push(`| Date | Min (°C) | Max (°C) | Total Precip (mm) |`);
        lines.push(`|---|---|---|---|`);
        for (const d of futureDays) {
          const dateStr = d.date.toLocaleDateString('en-CH', {
            timeZone: 'Europe/Zurich',
            weekday: 'short', month: 'short', day: 'numeric'
          });
          lines.push(`| ${dateStr} | ${d.tempMin?.toFixed(1) ?? '-'} | ${d.tempMax?.toFixed(1) ?? '-'} | ${d.precipTotal?.toFixed(1) ?? '-'} |`);
        }
        lines.push(``);
      }

      lines.push(`---`);
      lines.push(``);
    }

    lines.push(`## How to use this data`);
    lines.push(`Ask questions like:`);
    lines.push(`- "Will it be good weather for hiking tomorrow near ${forecasts[0]?.station.point_name}?"`);
    lines.push(`- "What are the temperature trends over the next 3 days?"`);
    lines.push(`- "Which station has the best conditions for outdoor activities?"`);
    lines.push(`- "Is there risk of thunderstorms in the next 24 hours?"`);

    return lines.join('\n');
  }
}
