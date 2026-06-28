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

function mapWmoToMeteoSwissIcon(wmoCode: number): number {
  if (wmoCode === 0) return 1; // Clear sky
  if (wmoCode === 1 || wmoCode === 2) return 3; // Mainly clear / partly cloudy
  if (wmoCode === 3) return 8; // Overcast
  if (wmoCode === 45 || wmoCode === 48) return 31; // Fog
  if (wmoCode === 51 || wmoCode === 53 || wmoCode === 55) return 10; // Drizzle
  if (wmoCode === 56 || wmoCode === 57) return 23; // Freezing drizzle -> Snow
  if (wmoCode === 61 || wmoCode === 63) return 14; // Rain
  if (wmoCode === 65) return 16; // Heavy rain
  if (wmoCode === 66 || wmoCode === 67) return 24; // Freezing rain -> Snow/rain
  if (wmoCode === 71 || wmoCode === 73 || wmoCode === 75 || wmoCode === 77) return 22; // Snow
  if (wmoCode === 80 || wmoCode === 81 || wmoCode === 82) return 11; // Showers
  if (wmoCode === 85 || wmoCode === 86) return 23; // Snow showers
  if (wmoCode === 95) return 19; // Thunderstorm
  if (wmoCode === 96 || wmoCode === 99) return 29; // Thunderstorm with hail
  return 1;
}

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

  /** Fetch forecast for a set of stations from the high-resolution regional models of Open-Meteo */
  getForecastsForStations(stations: WeatherStation[]): Observable<StationForecast[]> {
    if (stations.length === 0) return of([]);

    const lats = stations.map(s => s.lat).join(',');
    const lons = stations.map(s => s.lon).join(',');

    const url = `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lats}&longitude=${lons}` +
      `&hourly=temperature_2m,precipitation,wind_speed_10m,wind_gusts_10m,precipitation_probability,sunshine_duration,weather_code,cloud_cover_low` +
      `&daily=temperature_2m_min,temperature_2m_max,precipitation_sum,weather_code` +
      `&timezone=UTC`;

    return this.http.get<any>(url).pipe(
      map(res => {
        const arrayRes = Array.isArray(res) ? res : [res];

        return arrayRes.map((data, idx) => {
          const station = stations[idx];

          const hourly: HourlyForecast[] = [];
          if (data.hourly && data.hourly.time) {
            const hTime = data.hourly.time;
            const hTemp = data.hourly.temperature_2m || [];
            const hPrecip = data.hourly.precipitation || [];
            const hWind = data.hourly.wind_speed_10m || [];
            const hGust = data.hourly.wind_gusts_10m || [];
            const hProb = data.hourly.precipitation_probability || [];
            const hSun = data.hourly.sunshine_duration || [];
            const hCode = data.hourly.weather_code || [];
            const hCloud = data.hourly.cloud_cover_low || [];

            for (let i = 0; i < hTime.length; i++) {
              hourly.push({
                datetime: new Date(hTime[i] + 'Z'),
                temperature: hTemp[i],
                precipitation: hPrecip[i],
                windSpeed: hWind[i],
                windGust: hGust[i],
                precipProb: hProb[i],
                sunshine: hSun[i] !== undefined ? Math.round(hSun[i] / 60) : undefined,
                cloudCoverLow: hCloud[i],
                weatherIcon: hCode[i] !== undefined ? mapWmoToMeteoSwissIcon(hCode[i]) : undefined
              });
            }
          }

          const daily: DailyForecast[] = [];
          if (data.daily && data.daily.time) {
            const dTime = data.daily.time;
            const dMin = data.daily.temperature_2m_min || [];
            const dMax = data.daily.temperature_2m_max || [];
            const dPrecip = data.daily.precipitation_sum || [];
            const dCode = data.daily.weather_code || [];

            for (let i = 0; i < dTime.length; i++) {
              daily.push({
                date: new Date(dTime[i] + 'T00:00:00Z'),
                tempMin: dMin[i],
                tempMax: dMax[i],
                precipTotal: dPrecip[i],
                weatherIcon: dCode[i] !== undefined ? mapWmoToMeteoSwissIcon(dCode[i]) : undefined
              });
            }
          }

          return {
            station,
            hourly,
            daily,
            fetchedAt: new Date()
          };
        });
      }),
      catchError(err => {
        console.error('Open-Meteo query failed:', err);
        return of(stations.map(s => ({
          station: s,
          hourly: [],
          daily: [],
          fetchedAt: new Date()
        })));
      })
    );
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
