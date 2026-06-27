import { Component, Input, OnChanges, SimpleChanges, ElementRef, ViewChild, AfterViewInit, inject, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StationForecast, HourlyForecast, DailyForecast } from '../weather.service';

@Component({
  selector: 'app-forecast-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="chart-wrap">
      <!-- Tab bar -->
      <div class="tab-bar">
        <button class="tab" [class.active]="activeTab === 'hourly'" (click)="activeTab='hourly'">
          <span class="material-icons">schedule</span> Hourly
        </button>
        <button class="tab" [class.active]="activeTab === 'daily'" (click)="activeTab='daily'">
          <span class="material-icons">calendar_today</span> 8-Day
        </button>
      </div>

      <!-- Hourly view -->
      <div class="chart-area" *ngIf="activeTab === 'hourly'">
        <div class="scroll-hint" *ngIf="(forecast?.hourly?.length ?? 0) > 0">→ scroll</div>
        <div class="chart-scroll">
          <div class="hourly-grid" *ngIf="(forecast?.hourly?.length ?? 0) > 0">
            <!-- Temperature bar chart -->
            <div class="param-row temp-row">
              <div class="param-label">
                <span class="material-icons">thermostat</span>
                <span>Temp (°C)</span>
              </div>
              <div class="bar-track">
                <ng-container *ngFor="let h of displayHourly">
                  <div class="bar-col">
                    <span class="bar-value" *ngIf="h.temperature !== undefined">{{ h.temperature | number:'1.0-0' }}</span>
                    <div class="temp-bar"
                         [style.height.px]="getTempBarHeight(h.temperature)"
                         [style.background]="getTempColor(h.temperature)"></div>
                  </div>
                </ng-container>
              </div>
            </div>

            <!-- Precipitation row -->
            <div class="param-row precip-row">
              <div class="param-label">
                <span class="material-icons">water_drop</span>
                <span>Precip (mm)</span>
              </div>
              <div class="bar-track">
                <ng-container *ngFor="let h of displayHourly">
                  <div class="bar-col">
                    <span class="bar-value small" *ngIf="h.precipitation && h.precipitation > 0">{{ h.precipitation | number:'1.0-1' }}</span>
                    <div class="precip-bar"
                         [style.height.px]="getPrecipBarHeight(h.precipitation)"
                         [style.opacity]="getPrecipOpacity(h.precipitation)"></div>
                  </div>
                </ng-container>
              </div>
            </div>

            <!-- Wind row -->
            <div class="param-row wind-row">
              <div class="param-label">
                <span class="material-icons">air</span>
                <span>Wind (km/h)</span>
              </div>
              <div class="bar-track">
                <ng-container *ngFor="let h of displayHourly">
                  <div class="bar-col">
                    <span class="bar-value small" *ngIf="h.windSpeed !== undefined">{{ h.windSpeed | number:'1.0-0' }}</span>
                    <div class="wind-bar"
                         [style.height.px]="getWindBarHeight(h.windSpeed)"
                         [class.gust-high]="(h.windGust ?? 0) > 60"></div>
                  </div>
                </ng-container>
              </div>
            </div>

            <!-- Time axis -->
            <div class="time-axis">
              <div class="param-label" style="opacity:0">·</div>
              <div class="bar-track time-track">
                <ng-container *ngFor="let h of displayHourly">
                  <div class="time-col" [class.day-start]="isDayStart(h)">
                    <span class="time-hour">{{ getHourLabel(h) }}</span>
                    <span class="time-day" *ngIf="isDayStart(h)">{{ getDayLabel(h) }}</span>
                  </div>
                </ng-container>
              </div>
            </div>
          </div>

          <div class="no-data" *ngIf="(forecast?.hourly?.length ?? 0) === 0">
            No hourly data available
          </div>
        </div>
      </div>

      <!-- Daily 8-day view -->
      <div class="chart-area" *ngIf="activeTab === 'daily'">
        <div class="daily-grid" *ngIf="(forecast?.daily?.length ?? 0) > 0">
          <ng-container *ngFor="let d of displayDaily">
            <div class="daily-card" [class.today]="isToday(d.date)">
              <div class="daily-date">
                <span class="day-name">{{ getDayName(d.date) }}</span>
                <span class="day-num">{{ d.date | date:'d MMM' }}</span>
              </div>
              <div class="daily-icon">{{ getWeatherEmoji(d.weatherIcon) }}</div>
              <div class="daily-temps">
                <span class="temp-max" *ngIf="d.tempMax !== undefined">{{ d.tempMax | number:'1.0-0' }}°</span>
                <span class="temp-divider">/</span>
                <span class="temp-min" *ngIf="d.tempMin !== undefined">{{ d.tempMin | number:'1.0-0' }}°</span>
              </div>
              <div class="daily-precip" *ngIf="d.precipTotal !== undefined && d.precipTotal > 0">
                <span class="material-icons" style="font-size:12px;color:#39d0f5">water_drop</span>
                {{ d.precipTotal | number:'1.0-1' }} mm
              </div>
            </div>
          </ng-container>
        </div>
        <div class="no-data" *ngIf="(forecast?.daily?.length ?? 0) === 0">
          No daily data available
        </div>
      </div>
    </div>
  `,
  styles: [`
    .chart-wrap {
      background: var(--bg-tertiary);
      border-radius: var(--radius-md);
      overflow: hidden;
      border: 1px solid var(--border-subtle);
    }
    .tab-bar {
      display: flex;
      border-bottom: 1px solid var(--border-subtle);
      background: var(--bg-card);
    }
    .tab {
      flex: 1;
      padding: 8px 12px;
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-family: var(--font-body);
      font-size: 12px;
      font-weight: 500;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      transition: all 0.2s;
      border-bottom: 2px solid transparent;
    }
    .tab .material-icons { font-size: 14px; }
    .tab:hover { color: var(--text-primary); background: rgba(255,255,255,0.04); }
    .tab.active {
      color: var(--accent-blue);
      border-bottom-color: var(--accent-blue);
      background: rgba(88,166,255,0.05);
    }
    .chart-area { position: relative; }

    /* ── Hourly chart ─────────────────────────── */
    .scroll-hint {
      position: absolute;
      right: 8px;
      top: 6px;
      font-size: 10px;
      color: var(--text-muted);
      pointer-events: none;
      z-index: 2;
    }
    .chart-scroll {
      overflow-x: auto;
      padding: 8px 8px 0;
    }
    .hourly-grid {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: max-content;
    }
    .param-row {
      display: flex;
      align-items: flex-end;
      gap: 0;
    }
    .param-label {
      width: 90px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 10px;
      color: var(--text-muted);
      padding-bottom: 4px;
    }
    .param-label .material-icons { font-size: 13px; }
    .bar-track {
      display: flex;
      align-items: flex-end;
      gap: 3px;
      padding-bottom: 4px;
    }
    .bar-col {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 28px;
      gap: 2px;
    }
    .bar-value {
      font-size: 10px;
      color: var(--text-primary);
      font-weight: 600;
      line-height: 1;
    }
    .bar-value.small { font-size: 9px; color: var(--text-secondary); }
    .temp-bar {
      width: 20px;
      border-radius: 4px 4px 0 0;
      min-height: 2px;
      transition: height 0.3s;
    }
    .precip-bar {
      width: 20px;
      background: #39d0f5;
      border-radius: 4px 4px 0 0;
      min-height: 0;
      transition: height 0.3s;
    }
    .wind-bar {
      width: 20px;
      background: #58a6ff;
      border-radius: 4px 4px 0 0;
      min-height: 0;
    }
    .wind-bar.gust-high { background: #f8884b; }
    .time-axis { border-top: 1px solid var(--border-subtle); margin-top: 2px; }
    .time-track { align-items: flex-start; padding-top: 3px; padding-bottom: 4px; }
    .time-col {
      width: 28px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1px;
    }
    .time-col.day-start { border-left: 1px solid var(--border-muted); }
    .time-hour {
      font-size: 9px;
      color: var(--text-muted);
      font-family: var(--font-mono);
    }
    .time-day {
      font-size: 9px;
      color: var(--accent-blue);
      font-weight: 600;
      white-space: nowrap;
    }

    /* ── Daily grid ───────────────────────────── */
    .daily-grid {
      display: flex;
      gap: 6px;
      padding: 10px;
      overflow-x: auto;
    }
    .daily-card {
      flex: 0 0 auto;
      min-width: 72px;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 10px 6px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      transition: all 0.2s;
    }
    .daily-card:hover {
      border-color: var(--border-accent);
      transform: translateY(-2px);
    }
    .daily-card.today {
      border-color: var(--accent-blue);
      background: rgba(88,166,255,0.08);
    }
    .daily-date { text-align: center; }
    .day-name { display: block; font-size: 11px; font-weight: 600; color: var(--text-primary); }
    .day-num { display: block; font-size: 10px; color: var(--text-muted); }
    .daily-icon { font-size: 22px; line-height: 1.2; }
    .daily-temps {
      display: flex;
      align-items: center;
      gap: 2px;
      font-size: 12px;
    }
    .temp-max { font-weight: 700; color: #f8884b; }
    .temp-divider { color: var(--text-muted); }
    .temp-min { color: var(--accent-cyan); }
    .daily-precip {
      display: flex;
      align-items: center;
      gap: 2px;
      font-size: 10px;
      color: var(--text-secondary);
    }
    .no-data {
      padding: 24px;
      text-align: center;
      color: var(--text-muted);
      font-size: 12px;
    }
  `]
})
export class ForecastChartComponent implements OnChanges {
  @Input() forecast: StationForecast | null = null;

  activeTab: 'hourly' | 'daily' = 'hourly';

  get displayHourly(): HourlyForecast[] {
    if (!this.forecast) return [];
    const now = new Date();
    return this.forecast.hourly
      .filter(h => h.datetime >= now)
      .slice(0, 72);
  }

  get displayDaily(): DailyForecast[] {
    if (!this.forecast) return [];
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return this.forecast.daily
      .filter(d => d.date >= todayStart)
      .slice(0, 8);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['forecast']) {
      this.activeTab = 'hourly';
    }
  }

  // ── Temperature bars ──
  private get tempRange(): { min: number; max: number } {
    const temps = this.displayHourly.map(h => h.temperature).filter(t => t !== undefined) as number[];
    if (!temps.length) return { min: 0, max: 30 };
    return { min: Math.min(...temps), max: Math.max(...temps) };
  }

  getTempBarHeight(temp?: number): number {
    if (temp === undefined) return 0;
    const { min, max } = this.tempRange;
    const range = Math.max(max - min, 1);
    return Math.max(4, ((temp - min) / range) * 60 + 4);
  }

  getTempColor(temp?: number): string {
    if (temp === undefined) return '#8b949e';
    if (temp <= 0)  return '#39d0f5';
    if (temp <= 10) return '#4c8ef7';
    if (temp <= 20) return '#3fb950';
    if (temp <= 28) return '#f0c000';
    return '#f85149';
  }

  // ── Precipitation bars ──
  private get maxPrecip(): number {
    const vals = this.displayHourly.map(h => h.precipitation).filter(v => v !== undefined) as number[];
    return Math.max(1, ...vals);
  }

  getPrecipBarHeight(precip?: number): number {
    if (!precip) return 0;
    return Math.max(2, (precip / this.maxPrecip) * 48);
  }

  getPrecipOpacity(precip?: number): number {
    if (!precip) return 0;
    return Math.min(1, 0.3 + (precip / this.maxPrecip) * 0.7);
  }

  // ── Wind bars ──
  private get maxWind(): number {
    const vals = this.displayHourly.map(h => h.windSpeed).filter(v => v !== undefined) as number[];
    return Math.max(10, ...vals);
  }

  getWindBarHeight(speed?: number): number {
    if (!speed) return 2;
    return Math.max(2, (speed / this.maxWind) * 48);
  }

  // ── Time axis ──
  isDayStart(h: HourlyForecast): boolean {
    return h.datetime.getUTCHours() === 0;
  }

  getHourLabel(h: HourlyForecast): string {
    const localHour = new Date(h.datetime.getTime()).toLocaleString('de-CH', {
      timeZone: 'Europe/Zurich', hour: '2-digit', hour12: false
    });
    return localHour;
  }

  getDayLabel(h: HourlyForecast): string {
    return h.datetime.toLocaleString('en-CH', {
      timeZone: 'Europe/Zurich', weekday: 'short'
    });
  }

  // ── Daily helpers ──
  isToday(date: Date): boolean {
    const now = new Date();
    return date.getUTCFullYear() === now.getFullYear() &&
           date.getUTCMonth() === now.getMonth() &&
           date.getUTCDate() === now.getDate();
  }

  getDayName(date: Date): string {
    if (this.isToday(date)) return 'Today';
    return date.toLocaleString('en-CH', { timeZone: 'Europe/Zurich', weekday: 'short' });
  }

  // MeteoSwiss weather icon code → emoji
  getWeatherEmoji(code?: number): string {
    if (!code) return '🌡️';
    if (code <= 2)  return '☀️';
    if (code <= 5)  return '🌤️';
    if (code <= 8)  return '⛅';
    if (code <= 12) return '🌦️';
    if (code <= 16) return '🌧️';
    if (code <= 20) return '⛈️';
    if (code <= 24) return '🌨️';
    if (code <= 27) return '❄️';
    if (code <= 30) return '🌩️';
    return '🌫️';
  }
}
