import { Component, Input, Output, EventEmitter, OnChanges, ViewChild, ElementRef, inject, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StationForecast, WeatherStation, WeatherService } from '../weather.service';
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

      <!-- Station tabs + content -->
      <div class="stations-content" *ngIf="!isLoading && forecasts.length > 0">
        <!-- Station selector -->
        <div class="station-tabs">
          <button
            *ngFor="let fc of forecasts; let i = index"
            class="station-tab"
            [class.active]="selectedIndex === i"
            (click)="selectStation(i)">
            <div class="station-rank" [style.background]="rankColors[i]">{{ i + 1 }}</div>
            <div class="station-info">
              <span class="station-abbr">{{ fc.station.station_abbr }}</span>
              <span class="station-dist">{{ fc.station.distanceKm | number:'1.0-1' }} km</span>
            </div>
          </button>
        </div>

        <!-- Selected station details -->
        <div class="station-detail" *ngIf="selectedForecast">
          <div class="station-header">
            <div class="station-badge" [style.border-color]="rankColors[selectedIndex]">
              <span class="badge-abbr">{{ selectedForecast.station.station_abbr }}</span>
            </div>
            <div class="station-meta">
              <h2 class="station-name">{{ selectedForecast.station.point_name }}</h2>
              <div class="station-tags">
                <span class="tag">
                  <span class="material-icons">height</span>
                  {{ selectedForecast.station.point_height_masl | number:'1.0-0' }} m
                </span>
                <span class="tag">
                  <span class="material-icons">place</span>
                  {{ selectedForecast.station.distanceKm | number:'1.1-1' }} km away
                </span>
                <span class="tag">{{ selectedForecast.station.point_type_en }}</span>
              </div>
            </div>
          </div>

          <!-- Current / latest conditions -->
          <div class="current-conditions" *ngIf="currentHour">
            <div class="condition-card" *ngIf="currentHour.temperature !== undefined">
              <span class="cond-icon">🌡️</span>
              <span class="cond-value">{{ currentHour.temperature | number:'1.1-1' }}°C</span>
              <span class="cond-label">Temperature</span>
            </div>
            <div class="condition-card" *ngIf="currentHour.precipitation !== undefined">
              <span class="cond-icon">💧</span>
              <span class="cond-value">{{ currentHour.precipitation | number:'1.1-1' }} mm</span>
              <span class="cond-label">Precipitation</span>
            </div>
            <div class="condition-card" *ngIf="currentHour.windSpeed !== undefined">
              <span class="cond-icon">💨</span>
              <span class="cond-value">{{ currentHour.windSpeed | number:'1.0-0' }} km/h</span>
              <span class="cond-label">Wind</span>
            </div>
            <div class="condition-card" *ngIf="currentHour.precipProb !== undefined">
              <span class="cond-icon">☂️</span>
              <span class="cond-value">{{ currentHour.precipProb | number:'1.0-0' }}%</span>
              <span class="cond-label">Precip. prob.</span>
            </div>
          </div>

          <!-- Forecast chart -->
          <app-forecast-chart [forecast]="selectedForecast"></app-forecast-chart>
        </div>

        <!-- AI Export section -->
        <div class="ai-export">
          <button class="ai-btn" (click)="exportForAi()" [class.copied]="copied">
            <span class="material-icons">{{ copied ? 'check_circle' : 'content_copy' }}</span>
            {{ copied ? 'Copied!' : 'Copy AI-ready text' }}
          </button>

          <!-- Text preview (always visible after first copy, even if clipboard fails) -->
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
              rows="8">
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

    /* ── Stations content ────────────────────────── */
    .stations-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* Station tab selector */
    .station-tabs {
      display: flex;
      gap: 4px;
      padding: 10px 10px 0;
      overflow-x: auto;
      flex-shrink: 0;
    }
    .station-tab {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      cursor: pointer;
      transition: all 0.2s;
      color: var(--text-secondary);
      font-family: var(--font-body);
    }
    .station-tab:hover {
      border-color: var(--border-muted);
      color: var(--text-primary);
    }
    .station-tab.active {
      background: rgba(88,166,255,0.1);
      border-color: var(--accent-blue);
      color: var(--text-primary);
    }
    .station-rank {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      font-size: 10px;
      font-weight: 700;
      color: #0d1117;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .station-info { display: flex; flex-direction: column; align-items: flex-start; }
    .station-abbr { font-size: 11px; font-weight: 700; line-height: 1; }
    .station-dist { font-size: 10px; color: var(--text-muted); line-height: 1; }

    /* Station detail */
    .station-detail {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .station-header {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      background: var(--bg-card);
      border-radius: var(--radius-md);
      padding: 12px;
      border: 1px solid var(--border-subtle);
    }
    .station-badge {
      width: 44px;
      height: 44px;
      border-radius: var(--radius-md);
      border: 2px solid;
      background: rgba(255,255,255,0.04);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .badge-abbr {
      font-size: 12px;
      font-weight: 800;
      color: var(--text-primary);
      letter-spacing: 0.5px;
    }
    .station-meta { flex: 1; min-width: 0; }
    .station-name {
      font-size: 14px;
      font-weight: 700;
      color: var(--text-primary);
      margin-bottom: 6px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .station-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .tag {
      display: flex;
      align-items: center;
      gap: 2px;
      font-size: 10px;
      color: var(--text-muted);
      background: var(--bg-tertiary);
      border: 1px solid var(--border-subtle);
      border-radius: 4px;
      padding: 2px 5px;
    }
    .tag .material-icons { font-size: 11px; color: var(--accent-blue); }

    /* Current conditions */
    .current-conditions {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
    }
    .condition-card {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 10px 6px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      transition: all 0.2s;
    }
    .condition-card:hover {
      border-color: var(--border-accent);
      transform: translateY(-1px);
    }
    .cond-icon { font-size: 18px; line-height: 1; }
    .cond-value { font-size: 12px; font-weight: 700; color: var(--text-primary); }
    .cond-label { font-size: 9px; color: var(--text-muted); text-align: center; }

    /* AI export */
    .ai-export {
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex-shrink: 0;
      border-top: 1px solid var(--border-subtle);
    }
    .ai-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 10px;
      background: linear-gradient(135deg, rgba(88,166,255,0.15) 0%, rgba(57,208,245,0.1) 100%);
      border: 1px solid rgba(88,166,255,0.4);
      border-radius: var(--radius-md);
      color: var(--accent-blue);
      font-family: var(--font-body);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.25s;
      width: 100%;
    }
    .ai-btn:hover {
      background: linear-gradient(135deg, rgba(88,166,255,0.25) 0%, rgba(57,208,245,0.2) 100%);
      border-color: var(--accent-blue);
      box-shadow: 0 0 16px rgba(88,166,255,0.2);
      transform: translateY(-1px);
    }
    .ai-btn.copied {
      color: var(--accent-green);
      border-color: var(--accent-green);
      background: rgba(63,185,80,0.1);
    }
    .ai-btn .material-icons { font-size: 16px; }
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
  // aiText input kept for backward compat but we now generate locally
  @Input() aiText = '';
  @Output() aiTextRequested = new EventEmitter<void>(); // kept for compat

  @ViewChild('aiTextarea') aiTextareaEl?: ElementRef<HTMLTextAreaElement>;

  private weatherService = inject(WeatherService);
  private ngZone = inject(NgZone);

  selectedIndex = 0;
  copied = false;
  generatedText = '';
  aiTextDismissed = false;

  readonly rankColors = ['#f0c000', '#3fb950', '#58a6ff', '#bc8cff', '#f85149'];

  ngOnChanges(): void {
    // Reset on new location
    this.selectedIndex = 0;
    this.copied = false;
    this.generatedText = '';
    this.aiTextDismissed = false;
  }

  get selectedForecast(): StationForecast | null {
    return this.forecasts[this.selectedIndex] ?? null;
  }

  get currentHour() {
    if (!this.selectedForecast) return null;
    const now = new Date();
    const past = this.selectedForecast.hourly.filter(h => h.datetime <= now);
    return past.length > 0 ? past[past.length - 1] : this.selectedForecast.hourly[0] ?? null;
  }

  get displayAiText(): string {
    return this.aiTextDismissed ? '' : (this.generatedText || this.aiText);
  }

  selectStation(i: number): void {
    this.selectedIndex = i;
  }

  exportForAi(): void {
    if (!this.forecasts.length || this.clickedLat === null || this.clickedLon === null) return;

    // Generate the text directly here
    const text = this.weatherService.generateAiText(
      this.forecasts, this.clickedLat, this.clickedLon
    );
    console.log('[WeatherApp] AI text generated, length:', text.length, 'preview:', text.slice(0, 80));
    this.generatedText = text;
    this.aiTextDismissed = false;

    // Wait one tick so Angular renders the textarea, then copy from the visible element
    setTimeout(() => this.copyGeneratedText(text), 50);
  }

  private copyGeneratedText(text: string): void {
    // Primary: Clipboard API (HTTPS / localhost only)
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text)
        .then(() => this.markCopied())
        .catch(() => this.execCommandFromVisibleTextarea());
      return;
    }
    // Fallback: use the VISIBLE rendered textarea (definitely focusable)
    this.execCommandFromVisibleTextarea();
  }

  private execCommandFromVisibleTextarea(): void {
    const ta = this.aiTextareaEl?.nativeElement;
    if (!ta) {
      // textarea not rendered yet — shouldn't happen after 50ms but handle it
      console.warn('[WeatherApp] ai-textarea not found in DOM');
      this.markCopied(); // still show "copied" since text is visible
      return;
    }
    ta.focus();
    ta.setSelectionRange(0, ta.value.length); // select all
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    console.log('[WeatherApp] execCommand copy result:', ok);
    this.markCopied();
  }

  private markCopied(): void {
    this.ngZone.run(() => {
      this.copied = true;
      setTimeout(() => this.copied = false, 3000);
    });
  }

  dismissAiText(): void {
    this.aiTextDismissed = true;
  }
}

