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

  private stacItemCache = new Map<string, any>();

  private getSTACItemAssets(itemId: string): Observable<any> {
    if (this.stacItemCache.has(itemId)) return of(this.stacItemCache.get(itemId));

    return this.http.get<any>(`${STAC_BASE}/api/stac/v1/collections/${COLLECTION}/items/${itemId}`).pipe(
      map(item => {
        const assets = item?.assets ?? {};
        this.stacItemCache.set(itemId, assets);
        return assets;
      }),
      catchError(() => of({}))
    );
  }

  /** Fetch forecast for a set of stations using a Web Worker */
  getForecastsForStations(stations: WeatherStation[]): Observable<StationForecast[]> {
    if (stations.length === 0) return of([]);

    return this.getLatestItemId().pipe(
      switchMap(itemId => {
        if (!itemId) return of(stations.map(s => ({ station: s, hourly: [], daily: [], fetchedAt: new Date() })));

        const pointIds = stations.map(s => s.point_id);
        const date = itemId.replace('-ch', '');
        const urlMap: Record<string, string> = {};
        const allParams = [...HOURLY_PARAMS, ...DAILY_PARAMS];

        // Fetch STAC metadata once to resolve correct asset URLs
        return this.getSTACItemAssets(itemId).pipe(
          switchMap(assets => {
            for (const param of allParams) {
              const key = Object.keys(assets).find(k => k.includes(`.${param}.csv`));
              urlMap[param] = key ? assets[key].href : `${STAC_BASE}/${COLLECTION}/${itemId}/vnut12.lssw.${date}0000.${param}.csv`;
            }

            return new Observable<StationForecast[]>(observer => {
              // Instantiate the Web Worker!
              const worker = new Worker(new URL('./weather.worker', import.meta.url), { type: 'module' });

              worker.onmessage = ({ data }) => {
                if (data.success) {
                  // Re-instantiate datetime/date strings back to Date objects
                  const forecasts = data.forecasts.map((f: any) => ({
                    ...f,
                    hourly: f.hourly.map((h: any) => ({
                      ...h,
                      datetime: new Date(h.datetime)
                    })),
                    daily: f.daily.map((d: any) => ({
                      ...d,
                      date: new Date(d.date)
                    })),
                    fetchedAt: new Date(f.fetchedAt)
                  }));
                  observer.next(forecasts);
                } else {
                  observer.error(new Error(data.error));
                }
                observer.complete();
                worker.terminate();
              };

              worker.onerror = (err) => {
                observer.error(err);
                observer.complete();
                worker.terminate();
              };

              worker.postMessage({
                urls: urlMap,
                pointIds,
                stations
              });
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

  /** Find stations near a WGS84 coordinate, sorted by distance */
  private haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  private deg2rad(d: number) { return d * Math.PI / 180; }

  private getCacheKey(stations: WeatherStation[]): string {
    const ids = stations.map(s => s.point_id).sort().join('_');
    return `weather_fc_${ids}`;
  }

  getCachedForecasts(stations: WeatherStation[]): StationForecast[] | null {
    try {
      const key = this.getCacheKey(stations);
      const dataStr = localStorage.getItem(key);
      if (!dataStr) return null;

      const data = JSON.parse(dataStr);
      // Validate overall age: maximum 12 hours
      const ageMs = Date.now() - new Date(data.fetchedAt).getTime();
      if (ageMs > 12 * 60 * 60 * 1000) {
        localStorage.removeItem(key);
        return null;
      }

      // Convert date strings back to Date objects
      return data.forecasts.map((f: any) => ({
        ...f,
        hourly: f.hourly.map((h: any) => ({
          ...h,
          datetime: new Date(h.datetime)
        })),
        daily: f.daily.map((d: any) => ({
          ...d,
          date: new Date(d.date)
        })),
        fetchedAt: new Date(f.fetchedAt)
      }));
    } catch (e) {
      return null;
    }
  }

  saveForecastsToCache(stations: WeatherStation[], forecasts: StationForecast[]): void {
    try {
      const key = this.getCacheKey(stations);
      const payload = {
        fetchedAt: new Date(),
        forecasts
      };
      localStorage.setItem(key, JSON.stringify(payload));
    } catch (e) {
      console.warn('Failed to save forecasts to localStorage cache:', e);
    }
  }

  /** Generate AI-ready text summary for a set of forecasts */
  generateAiText(forecasts: StationForecast[], clickedLat: number, clickedLon: number, numDays = 3): string {
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

      // Next hours hourly based on numDays parameter
      const hoursCount = numDays * 24;
      const nextHours = fc.hourly
        .filter(h => h.datetime >= now)
        .slice(0, hoursCount);

      if (nextHours.length > 0) {
        lines.push(`#### Hourly Forecast (next ${hoursCount} hours)`);
        lines.push(`| Time (local) | Temp (°C) | Precip (mm) | Wind (km/h) | Gust (km/h) | Precip% | Sunshine (min) |`);
        lines.push(`|---|---|---|---|---|---|---|`);

        for (const h of nextHours) {
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

    let targetDayName = 'tomorrow';
    if (numDays > 1) {
      const targetDate = new Date(now);
      targetDate.setDate(now.getDate() + numDays);
      targetDayName = targetDate.toLocaleDateString('en-US', { weekday: 'long' });
    }
    lines.push(`How suitable does the weather for ${targetDayName} look for hiking?`);

    return lines.join('\n');
  }
}
