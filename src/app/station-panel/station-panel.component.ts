import { Component, Input, OnChanges, ViewChild, ElementRef, inject, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StationForecast, WeatherStation, WeatherService, HourlyForecast } from '../weather.service';
import { ForecastChartComponent } from '../forecast-chart/forecast-chart.component';

@Component({
  selector: 'app-station-panel',
  standalone: true,
  imports: [CommonModule, ForecastChartComponent],
  template: `
    <div class="panel">
      <!-- Header -->
      <div class="panel-header">
        <div class="header-title">
          <span class="material-icons header-icon">wb_sunny</span>
          <h1>Weather Stations</h1>
        </div>
        <div class="header-meta" *ngIf="clickedLat !== null">
          <span class="material-icons">location_on</span>
          {{ clickedLat | number:'1.4-4' }}°N &nbsp; {{ clickedLon | number:'1.4-4' }}°E
        </div>
      </div>

      <!-- Loading state -->
      <div class="loading-state" *ngIf="isLoading">
        <div class="spinner"></div>
        <span>Fetching nearby stations &amp; forecast data…</span>
      </div>

      <!-- Empty state -->
      <div class="empty-state" *ngIf="!isLoading && forecasts.length === 0 && clickedLat === null">
        <div class="empty-icon">🗺️</div>
        <h2>Select a location</h2>
        <p>Click anywhere on the Swiss map to discover nearby weather stations and their forecast.</p>
        <div class="feature-pills">
          <span class="pill">📍 5 nearest stations</span>
          <span class="pill">🌡️ 72h hourly forecast</span>
          <span class="pill">📅 8-day outlook</span>
          <span class="pill">🤖 AI text export</span>
        </div>
      </div>

      <!-- No stations found -->
      <div class="empty-state" *ngIf="!isLoading && forecasts.length === 0 && clickedLat !== null">
        <div class="empty-icon">🔍</div>
        <h2>No stations nearby</h2>
        <p>No weather stations found within 80 km of this location. Try clicking somewhere else.</p>
      </div>

      <!-- All stations list with individual charts -->
      <div class="stations-scroll" *ngIf="!isLoading && forecasts.length > 0">
        <div class="horizontal-scroll-container">
          <div class="stations-grid-layout">
            <div class="station-row" *ngFor="let fc of forecasts; let i = index">
              <!-- Sticky Left Station Header -->
              <div class="station-sticky-header">
                <div class="station-card-compact">
                  <div class="station-rank-name-row">
                    <div class="station-rank" [style.background]="rankColors[i]">{{ i + 1 }}</div>
                    <div class="station-name-wrap">
                      <span class="station-name" [title]="fc.station.point_name">{{ fc.station.point_name }}</span>
                      <span class="station-abbr">{{ fc.station.station_abbr }}</span>
                    </div>
                  </div>
                  <div class="station-meta-row">
                    <span class="detail-item"><span class="material-icons">height</span>{{ fc.station.point_height_masl | number:'1.0-0' }}m</span>
                    <span class="sep">|</span>
                    <span class="detail-item"><span class="material-icons">place</span>{{ fc.station.distanceKm | number:'1.1-1' }}km</span>
                  </div>
                  <div class="station-conditions-row" *ngIf="getHourForecast(fc, hoveredHourIndex) as cur">
                    <span class="cond-val" [class.hover-active]="hoveredHourIndex !== null">🌡️ {{ cur.temperature | number:'1.1-1' }}°C</span>
                    <span class="cond-val" [class.hover-active]="hoveredHourIndex !== null">💨 {{ cur.windSpeed | number:'1.0-0' }}k/h</span>
                  </div>
                </div>
              </div>

              <!-- Right Chart cell -->
              <div class="station-chart-cell">
                <app-forecast-chart
                  [forecast]="fc"
                  [hoveredHourIndex]="hoveredHourIndex"
                  (hoverChanged)="hoveredHourIndex = $event">
                </app-forecast-chart>
              </div>
            </div>
          </div>
        </div>

        <!-- AI Export section -->
        <div class="ai-export">
          <div class="ai-export-header">
            <span class="ai-export-label">
              <span class="material-icons">smart_toy</span>
              Copy AI-Ready Prompt
            </span>
          </div>
          <div class="ai-btn-group">
            <button class="ai-btn" (click)="exportForAi(1)" [class.copied]="copiedDays === 1">
              <span class="material-icons">{{ copiedDays === 1 ? 'check_circle' : 'content_copy' }}</span>
              1 Day
            </button>
            <button class="ai-btn" (click)="exportForAi(2)" [class.copied]="copiedDays === 2">
              <span class="material-icons">{{ copiedDays === 2 ? 'check_circle' : 'content_copy' }}</span>
              2 Days
            </button>
            <button class="ai-btn" (click)="exportForAi(3)" [class.copied]="copiedDays === 3">
              <span class="material-icons">{{ copiedDays === 3 ? 'check_circle' : 'content_copy' }}</span>
              3 Days
            </button>
          </div>

          <div class="ai-preview" *ngIf="displayAiText">
            <div class="ai-preview-header">
              <span class="ai-preview-label">
                <span class="material-icons">smart_toy</span>
                AI-ready text — paste into ChatGPT, Claude or Gemini
              </span>
              <button class="ai-preview-close" (click)="dismissAiText()" title="Dismiss">
                <span class="material-icons">close</span>
              </button>
            </div>
            <textarea
              #aiTextarea
              class="ai-textarea"
              readonly
              [value]="displayAiText"
              (click)="aiTextarea.select()"
              rows="4">
            </textarea>
            <span class="ai-textarea-hint">Click inside to select all, then Ctrl+C / Cmd+C</span>
          </div>

          <span class="ai-hint" *ngIf="!displayAiText">Paste into ChatGPT, Claude, or Gemini to ask questions about the forecast</span>
        </div>
      </div>

      <!-- Footer credit -->
      <div class="footer-credit">
        Source: <a href="https://www.meteoswiss.admin.ch/services-and-publications/service/open-data.html"
                   target="_blank" rel="noopener">MeteoSwiss Open Data</a> (CC-BY)
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
      min-height: 0;
    }
    .panel {
      height: 100%;
      display: flex;
      flex-direction: column;
      background: var(--bg-secondary);
      overflow: hidden;
    }

    /* ── Header ─────────────────────────────────── */
    .panel-header {
      padding: 16px 16px 12px;
      background: linear-gradient(135deg, #1a2744 0%, #161b22 100%);
      border-bottom: 1px solid var(--border-subtle);
      flex-shrink: 0;
    }
    .header-title {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }
    .header-icon {
      color: var(--accent-yellow);
      font-size: 20px;
    }
    h1 {
      font-size: 16px;
      font-weight: 700;
      background: var(--gradient-accent);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .header-meta {
      font-size: 11px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 3px;
    }
    .header-meta .material-icons { font-size: 12px; color: var(--accent-blue); }

    /* ── Loading ─────────────────────────────────── */
    .loading-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      color: var(--text-muted);
      font-size: 13px;
    }
    .spinner {
      width: 36px;
      height: 36px;
      border: 3px solid var(--border-muted);
      border-top-color: var(--accent-blue);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Empty state ─────────────────────────────── */
    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px 24px;
      text-align: center;
      gap: 12px;
    }
    .empty-icon { font-size: 48px; line-height: 1; }
    .empty-state h2 {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .empty-state p { font-size: 13px; color: var(--text-secondary); line-height: 1.6; }
    .feature-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      justify-content: center;
      margin-top: 8px;
    }
    .pill {
      font-size: 11px;
      padding: 4px 10px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-subtle);
      border-radius: 20px;
      color: var(--text-secondary);
    }

    /* ── Scrollable stations list ─────────────── */
    .stations-scroll {
      flex: 1;
      min-height: 0;
      overflow: hidden;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    /* Horizontal scroll layout styling */
    .horizontal-scroll-container {
      overflow-x: auto;
      overflow-y: auto;
      flex: 1;
      min-height: 0;
      width: 100%;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      background: var(--bg-tertiary);
    }
    .stations-grid-layout {
      display: flex;
      flex-direction: column;
      width: max-content;
    }
    .station-row {
      display: flex;
      align-items: stretch;
      border-bottom: 1px solid var(--border-subtle);
    }
    .station-row:last-child {
      border-bottom: none;
    }
    .station-sticky-header {
      position: sticky;
      left: 0;
      z-index: 10;
      background: var(--bg-secondary);
      width: 200px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 8px 12px;
      box-sizing: border-box;
      border-right: 1px solid var(--border-subtle);
    }
    .station-card-compact {
      display: flex;
      flex-direction: column;
      gap: 4px;
      width: 100%;
    }
    .station-rank-name-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .station-rank {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      font-size: 10px;
      font-weight: 800;
      color: #0d1117;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .station-name-wrap {
      display: flex;
      flex-direction: column;
      min-width: 0;
      flex: 1;
    }
    .station-name {
      font-size: 12px;
      font-weight: 700;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.2;
    }
    .station-abbr {
      font-size: 10px;
      color: var(--accent-cyan);
      font-weight: 600;
      line-height: 1.1;
    }
    .station-meta-row {
      display: flex;
      gap: 6px;
      font-size: 10px;
      color: var(--text-muted);
      align-items: center;
    }
    .station-meta-row .sep {
      color: var(--border-subtle);
    }
    .station-meta-row .detail-item {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .station-meta-row .detail-item .material-icons {
      font-size: 11px;
      color: var(--accent-blue);
    }
    .station-conditions-row {
      display: flex;
      gap: 8px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-secondary);
      margin-top: 2px;
    }
    .cond-val {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .cond-val.hover-active {
      color: var(--accent-cyan);
      font-weight: 700;
    }
    .station-chart-cell {
      flex: 1;
    }

    /* ── AI export ───────────────────────────── */
    .ai-export {
      padding: 10px 0 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
      border-top: 1px solid var(--border-subtle);
      margin-top: auto;
      flex-shrink: 0;
    }
    .ai-export-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .ai-export-label {
      font-size: 11px;
      font-weight: 700;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .ai-export-label .material-icons {
      font-size: 14px;
      color: var(--accent-cyan);
    }
    .ai-btn-group {
      display: flex;
      gap: 6px;
      width: 100%;
    }
    .ai-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 6px;
      background: linear-gradient(135deg, rgba(88,166,255,0.1) 0%, rgba(57,208,245,0.06) 100%);
      border: 1px solid rgba(88,166,255,0.3);
      border-radius: var(--radius-sm);
      color: var(--accent-blue);
      font-family: var(--font-body);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .ai-btn:hover {
      background: linear-gradient(135deg, rgba(88,166,255,0.2) 0%, rgba(57,208,245,0.12) 100%);
      border-color: var(--accent-blue);
      transform: translateY(-1px);
    }
    .ai-btn.copied {
      color: var(--accent-green);
      border-color: var(--accent-green);
      background: rgba(63,185,80,0.1);
    }
    .ai-btn .material-icons { font-size: 13px; }
    .ai-hint {
      font-size: 10px;
      color: var(--text-muted);
      text-align: center;
      line-height: 1.4;
    }
    /* AI text preview */
    .ai-preview {
      display: flex;
      flex-direction: column;
      gap: 4px;
      animation: fadeIn 0.2s ease;
    }
    .ai-preview-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .ai-preview-label {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 10px;
      color: var(--text-muted);
    }
    .ai-preview-label .material-icons { font-size: 13px; color: var(--accent-cyan); }
    .ai-preview-close {
      background: transparent;
      border: none;
      cursor: pointer;
      color: var(--text-muted);
      padding: 2px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      transition: color 0.15s;
    }
    .ai-preview-close:hover { color: var(--text-primary); }
    .ai-preview-close .material-icons { font-size: 14px; }
    .ai-textarea {
      width: 100%;
      max-height: 90px;
      background: var(--bg-primary);
      border: 1px solid var(--border-muted);
      border-radius: var(--radius-sm);
      color: var(--text-secondary);
      font-family: var(--font-mono);
      font-size: 10px;
      line-height: 1.5;
      padding: 8px;
      resize: vertical;
      cursor: text;
      transition: border-color 0.2s;
      box-sizing: border-box;
    }
    .ai-textarea:focus {
      outline: none;
      border-color: var(--accent-blue);
    }
    .ai-textarea-hint {
      font-size: 9px;
      color: var(--text-muted);
      text-align: center;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* Footer */
    .footer-credit {
      padding: 6px 12px;
      font-size: 10px;
      color: var(--text-muted);
      text-align: center;
      border-top: 1px solid var(--border-subtle);
      flex-shrink: 0;
    }
    .footer-credit a { color: var(--accent-blue); text-decoration: none; }
    .footer-credit a:hover { text-decoration: underline; }
  `]
})
export class StationPanelComponent implements OnChanges {
  @Input() forecasts: StationForecast[] = [];
  @Input() isLoading = false;
  @Input() clickedLat: number | null = null;
  @Input() clickedLon: number | null = null;

  @ViewChild('aiTextarea') aiTextareaEl?: ElementRef<HTMLTextAreaElement>;

  private weatherService = inject(WeatherService);
  private ngZone = inject(NgZone);

  hoveredHourIndex: number | null = null;
  copiedDays = 0;
  generatedText = '';
  aiTextDismissed = false;

  readonly rankColors = ['#f0c000', '#3fb950', '#58a6ff', '#bc8cff', '#f85149'];

  ngOnChanges(): void {
    this.copiedDays = 0;
    this.generatedText = '';
    this.aiTextDismissed = false;
    this.hoveredHourIndex = null;
  }

  getCurrentHour(fc: StationForecast): HourlyForecast | null {
    const now = new Date();
    const past = fc.hourly.filter(h => h.datetime <= now);
    return past.length > 0 ? past[past.length - 1] : fc.hourly[0] ?? null;
  }

  getHourForecast(fc: StationForecast, index: number | null): HourlyForecast | null {
    if (index === null) {
      return this.getCurrentHour(fc);
    }
    const now = new Date();
    const filtered = fc.hourly.filter(h => h.datetime >= now).slice(0, 72);
    return filtered[index] ?? null;
  }

  get displayAiText(): string {
    return this.aiTextDismissed ? '' : this.generatedText;
  }

  exportForAi(numDays: number): void {
    if (!this.forecasts.length || this.clickedLat === null || this.clickedLon === null) return;

    const text = this.weatherService.generateAiText(
      this.forecasts, this.clickedLat, this.clickedLon, numDays
    );
    console.log('[WeatherApp] AI text generated, length:', text.length, 'preview:', text.slice(0, 80));
    this.generatedText = text;
    this.aiTextDismissed = false;

    setTimeout(() => this.copyGeneratedText(text, numDays), 50);
  }

  private copyGeneratedText(text: string, numDays: number): void {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text)
        .then(() => this.markCopied(numDays))
        .catch(() => this.execCommandFromVisibleTextarea(numDays));
      return;
    }
    this.execCommandFromVisibleTextarea(numDays);
  }

  private execCommandFromVisibleTextarea(numDays: number): void {
    const ta = this.aiTextareaEl?.nativeElement;
    if (!ta) {
      console.warn('[WeatherApp] ai-textarea not found in DOM');
      this.markCopied(numDays);
      return;
    }
    ta.focus();
    ta.setSelectionRange(0, ta.value.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    console.log('[WeatherApp] execCommand copy result:', ok);
    this.markCopied(numDays);
  }

  private markCopied(numDays: number): void {
    this.ngZone.run(() => {
      this.copiedDays = numDays;
      setTimeout(() => {
        if (this.copiedDays === numDays) {
          this.copiedDays = 0;
        }
      }, 3000);
    });
  }

  dismissAiText(): void {
    this.aiTextDismissed = true;
  }
}
