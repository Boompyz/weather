import { Component, Input, OnChanges, SimpleChanges, Output, EventEmitter, OnDestroy, ElementRef, ViewChild, NgZone, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StationForecast, HourlyForecast, DailyForecast } from '../weather.service';

/** Column width per hour in px */
const COL_W = 32;
/** Left margin for Y-axis labels */
const LABEL_W = 60;
/** Height of the main temp+precip chart area */
const CHART_H = 100;
/** Max sunshine bar height */
const SUNSHINE_H = 40;

@Component({
  selector: 'app-forecast-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="chart-wrap">
      <!-- ──────────── HOURLY VIEW ──────────── -->
      <div class="chart-area" *ngIf="activeTab === 'hourly'">
        <div class="no-data" *ngIf="hours.length === 0">No hourly data available</div>

        <div class="meteo-scroll" *ngIf="hours.length > 0">
          <!-- All rows are inside this single scroll container -->
          <div class="meteo-canvas" [style.width.px]="canvasWidth">
            <!-- Global hover line -->
            <div *ngIf="hoveredHourIndex !== null"
                 class="global-hover-line"
                 [style.left.px]="60 + hoveredHourIndex * 32 + 16">
            </div>

            <!-- 1 ─ Weather icons row -->
            <div class="row row-icons">
              <div class="y-label"></div>
              <div class="row-content">
                <div class="icon-cell" *ngFor="let h of hours">
                  {{ getWeatherEmoji(h.weatherIcon) }}
                </div>
              </div>
            </div>

            <!-- 2 ─ Wind row -->
            <div class="row row-wind">
              <div class="y-label">Wind km/h</div>
              <div class="row-content">
                <div class="wind-cell" *ngFor="let h of hours">
                  <span class="wind-val" *ngIf="h.windSpeed !== undefined">{{ h.windSpeed | number:'1.0-0' }}</span>
                </div>
              </div>
            </div>

            <!-- 3 ─ Sunshine bar chart -->
            <div class="row row-sunshine">
              <div class="y-label">Sunshine<br>min/h</div>
              <div class="row-content" style="align-items: flex-end;">
                <div class="sunshine-col" *ngFor="let h of hours">
                  <div class="sunshine-bar"
                       [style.height.px]="getSunshineHeight(h.sunshine)"></div>
                </div>
              </div>
            </div>

            <!-- 4 ─ Temperature line + Precipitation bars (SVG) -->
            <div class="row row-chart">
              <div class="y-label y-label-dual">
                <span class="y-temp-label">°C</span>
                <div class="y-ticks">
                  <span *ngFor="let t of tempTicks" class="y-tick"
                        [style.bottom.px]="tempToY(t)">{{ t }}</span>
                </div>
              </div>
              <div #chartContent class="row-content chart-content">
                <!-- Gridlines -->
                <svg class="chart-grid" [attr.viewBox]="'0 0 ' + svgW + ' ' + CHART_H"
                     [attr.width]="svgW" [attr.height]="CHART_H" preserveAspectRatio="none">
                  <line *ngFor="let t of tempTicks"
                        [attr.x1]="0" [attr.y1]="CHART_H - tempToY(t)"
                        [attr.x2]="svgW" [attr.y2]="CHART_H - tempToY(t)"
                        class="grid-line"/>
                  <line *ngFor="let x of daySepXPositions"
                        [attr.x1]="x" [attr.y1]="0"
                        [attr.x2]="x" [attr.y2]="CHART_H"
                        class="day-sep-line"/>
                </svg>

                <!-- Precipitation bars -->
                <svg class="chart-precip" [attr.viewBox]="'0 0 ' + svgW + ' ' + CHART_H"
                     [attr.width]="svgW" [attr.height]="CHART_H" preserveAspectRatio="none">
                  <rect *ngFor="let bar of precipBars"
                        [attr.x]="bar.x" [attr.y]="bar.y"
                        [attr.width]="bar.w" [attr.height]="bar.h"
                        class="precip-bar"/>
                </svg>

                <!-- Temperature confidence band + line -->
                <svg class="chart-temp" [attr.viewBox]="'0 0 ' + svgW + ' ' + CHART_H"
                     [attr.width]="svgW" [attr.height]="CHART_H" preserveAspectRatio="none">
                  <path *ngIf="tempBandPath" [attr.d]="tempBandPath" class="temp-band"/>
                  <path *ngIf="tempLinePath" [attr.d]="tempLinePath" class="temp-line"/>
                  <circle *ngFor="let pt of tempPoints"
                          [attr.cx]="pt.x" [attr.cy]="pt.y" r="2.5"
                          class="temp-dot"/>
                  <!-- Hover highlight dot -->
                  <ng-container *ngIf="getHoveredPoint() as pt">
                    <circle [attr.cx]="pt.x" [attr.cy]="pt.y" r="4.5" class="temp-dot-hovered"/>
                  </ng-container>
                </svg>

                <!-- Floating exact temp label -->
                <div *ngIf="getHoveredPoint() as pt"
                     class="hover-temp-label"
                     [style.left.px]="pt.x"
                     [style.top.px]="pt.y < 25 ? pt.y + 12 : pt.y - 25">
                  {{ hours[hoveredHourIndex!].temperature | number:'1.1-1' }}°C
                </div>

                <div class="y-right-label">mm/h</div>
              </div>
            </div>

            <!-- 5 ─ Time axis -->
            <div class="row row-time">
              <div class="y-label"></div>
              <div class="row-content">
                <div class="time-cell" *ngFor="let h of hours; let i = index"
                     [class.day-start]="isDayBoundary(i)"
                     [class.hover-highlight]="i === hoveredHourIndex">
                  <span class="time-hour" *ngIf="showHourLabel(h) || i === hoveredHourIndex">{{ formatHour(h) }}</span>
                  <span class="time-day" *ngIf="isDayBoundary(i)">{{ formatDayLabel(h) }}</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

      <!-- ──────────── DAILY 8-DAY VIEW ──────────── -->
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
    /* ── Base / wrap ─────────────────────────────────── */
    .chart-wrap {
      background: transparent;
      overflow: visible;
    }

    /* ── Tabs ────────────────────────────────────────── */
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

    /* ── MeteoSwiss scroll container ─────────────────── */
    .meteo-scroll {
      /* No overflow here — parent panel controls horizontal scroll */
      padding: 4px 0 0 0;
    }
    .meteo-canvas {
      display: flex;
      flex-direction: column;
      min-width: max-content;
      position: relative;
    }

    /* ── Generic row ────────────────────────────────── */
    .row {
      display: flex;
      align-items: stretch;
    }
    .y-label {
      width: 60px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding-right: 6px;
      font-size: 9px;
      color: var(--text-muted);
      font-family: var(--font-mono);
      line-height: 1.2;
      text-align: right;
      white-space: nowrap;
      position: sticky;
      left: 200px;
      background: var(--bg-secondary);
      z-index: 8;
      box-shadow: 1px 0 0 var(--border-subtle);
    }
    .row-content {
      display: flex;
      flex: 1;
      min-width: 0;
    }

    /* ── 1. Icons row ───────────────────────────────── */
    .row-icons {
      border-bottom: 1px solid var(--border-subtle);
    }
    .icon-cell {
      width: 32px;
      flex-shrink: 0;
      text-align: center;
      font-size: 14px;
      line-height: 26px;
      height: 26px;
    }

    /* ── 2. Wind row ────────────────────────────────── */
    .row-wind {
      border-bottom: 1px solid var(--border-subtle);
      height: 24px;
    }
    .wind-cell {
      width: 32px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .wind-val {
      font-size: 9px;
      color: var(--text-secondary);
      font-family: var(--font-mono);
    }

    /* ── 3. Sunshine row ────────────────────────────── */
    .row-sunshine {
      height: 40px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .sunshine-col {
      width: 32px;
      flex-shrink: 0;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      height: 100%;
    }
    .sunshine-bar {
      width: 18px;
      background: #c8a415;
      border-radius: 3px 3px 0 0;
      min-height: 0;
      transition: height 0.3s;
    }

    /* ── 4. Temp + Precip chart ──────────────────────── */
    .row-chart {
      height: 100px;
      border-bottom: 1px solid var(--border-subtle);
      position: relative;
    }
    .y-label-dual {
      flex-direction: column;
      align-items: flex-end;
      justify-content: flex-start;
    }
    .y-temp-label {
      font-size: 10px;
      color: #e05555;
      font-weight: 600;
      margin-top: 4px;
      align-self: flex-start;
      padding-left: 10px;
    }
    .y-ticks {
      position: absolute;
      top: 0;
      bottom: 0;
      right: 6px;
      width: 30px;
    }
    .y-tick {
      position: absolute;
      right: 0;
      font-size: 8px;
      color: var(--text-muted);
      font-family: var(--font-mono);
      transform: translateY(50%);
    }
    .chart-content {
      position: relative;
      height: 100px;
      flex: 1;
    }
    .chart-grid, .chart-precip, .chart-temp {
      position: absolute;
      top: 0;
      left: 0;
    }
    .grid-line {
      stroke: var(--border-subtle);
      stroke-width: 1;
      stroke-dasharray: 4 3;
    }
    .day-sep-line {
      stroke: var(--border-subtle);
      stroke-width: 1;
    }
    .precip-bar {
      fill: #58a6ff;
      opacity: 0.55;
    }
    .temp-band {
      fill: rgba(224, 85, 85, 0.12);
    }
    .temp-line {
      fill: none;
      stroke: #e05555;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .temp-dot {
      fill: #e05555;
    }
    .y-right-label {
      position: absolute;
      top: 4px;
      right: 4px;
      font-size: 10px;
      color: #58a6ff;
      font-weight: 600;
      font-family: var(--font-mono);
    }

    /* ── 5. Time axis ────────────────────────────────── */
    .row-time {
      min-height: 36px;
    }
    .time-cell {
      width: 32px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      padding-top: 3px;
      gap: 1px;
      position: relative;
    }
    .time-cell.day-start::before {
      content: '';
      position: absolute;
      left: 0;
      top: -2px;
      bottom: -2px;
      width: 1px;
      background: var(--text-muted);
    }
    .time-hour {
      font-size: 9px;
      color: var(--text-muted);
      font-family: var(--font-mono);
    }
    .time-day {
      font-size: 8px;
      color: var(--accent-blue);
      font-weight: 600;
      white-space: nowrap;
    }

    /* ── Daily grid ──────────────────────────────────── */
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

    /* ── Hover styles ────────────────────────────────── */
    .global-hover-line {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 1px;
      border-left: 1px dashed var(--accent-cyan);
      opacity: 0.65;
      pointer-events: none;
      z-index: 9;
    }
    .temp-dot-hovered {
      fill: var(--accent-cyan);
      stroke: var(--bg-primary);
      stroke-width: 1.5;
    }
    .hover-temp-label {
      position: absolute;
      transform: translateX(-50%);
      background: rgba(22, 27, 34, 0.95);
      border: 1px solid var(--accent-cyan);
      border-radius: 4px;
      color: var(--text-primary);
      font-size: 10px;
      font-family: var(--font-mono);
      font-weight: 700;
      padding: 2px 5px;
      pointer-events: none;
      white-space: nowrap;
      z-index: 12;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    }
    .time-cell.hover-highlight {
      background: rgba(57, 208, 245, 0.12);
      border-radius: 4px;
    }
    .time-cell.hover-highlight .time-hour {
      color: var(--accent-cyan);
      font-weight: 700;
    }
  `]
})
export class ForecastChartComponent implements OnChanges, OnDestroy {
  @Input() forecast: StationForecast | null = null;
  @Input() hoveredHourIndex: number | null = null;
  @Output() hoverChanged = new EventEmitter<number | null>();

  private ngZone = inject(NgZone);
  private chartContentEl: HTMLElement | null = null;

  @ViewChild('chartContent') set chartContent(element: ElementRef<HTMLElement> | undefined) {
    console.log('[ForecastChart] chartContent setter called with:', element);
    if (this.chartContentEl) {
      this.cleanupHoverListeners(this.chartContentEl);
      this.chartContentEl = null;
    }
    if (element) {
      this.chartContentEl = element.nativeElement;
      this.setupHoverListeners(this.chartContentEl);
    }
  }

  activeTab: 'hourly' | 'daily' = 'hourly';

  readonly CHART_H = CHART_H;

  // ── Computed data ──────────────────────────────────────────
  hours: HourlyForecast[] = [];
  svgW = 0;
  canvasWidth = 0;

  // Temperature
  tempPoints: { x: number; y: number; index: number }[] = [];
  tempLinePath = '';
  tempBandPath = '';
  tempTicks: number[] = [];
  private tempMin = 0;
  private tempMax = 30;

  // Precipitation
  precipBars: { x: number; y: number; w: number; h: number }[] = [];
  private precipMax = 1;

  // Day separators
  daySepXPositions: number[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['forecast']) {
      this.activeTab = 'hourly';
      this.recalculate();
    }
  }

  private recalculate(): void {
    if (!this.forecast) {
      this.hours = [];
      return;
    }

    const now = new Date();
    this.hours = this.forecast.hourly
      .filter(h => h.datetime >= now)
      .slice(0, 72);

    const n = this.hours.length;
    this.svgW = n * COL_W;
    this.canvasWidth = LABEL_W + this.svgW + 30; // 30px for right label space

    this.calcTempData();
    this.calcPrecipData();
    this.calcDaySeps();
  }

  // ── Temperature ────────────────────────────────────────────
  private calcTempData(): void {
    const temps = this.hours
      .map(h => h.temperature)
      .filter((t): t is number => t !== undefined);

    if (temps.length === 0) {
      this.tempMin = 0;
      this.tempMax = 30;
    } else {
      const rawMin = Math.min(...temps);
      const rawMax = Math.max(...temps);
      const padding = Math.max(2, (rawMax - rawMin) * 0.15);
      this.tempMin = Math.floor(rawMin - padding);
      this.tempMax = Math.ceil(rawMax + padding);
    }

    // Generate nice tick values
    const range = this.tempMax - this.tempMin;
    let step = 5;
    if (range <= 10) step = 2;
    else if (range <= 20) step = 5;
    else step = 10;

    this.tempTicks = [];
    const startTick = Math.ceil(this.tempMin / step) * step;
    for (let v = startTick; v <= this.tempMax; v += step) {
      this.tempTicks.push(v);
    }

    // Build points
    this.tempPoints = [];
    for (let i = 0; i < this.hours.length; i++) {
      const t = this.hours[i].temperature;
      if (t === undefined) continue;
      const x = i * COL_W + COL_W / 2;
      const y = CHART_H - this.tempToY(t);
      this.tempPoints.push({ x, y, index: i });
    }

    // Build smooth bezier path
    if (this.tempPoints.length >= 2) {
      this.tempLinePath = this.monotoneCubicPath(this.tempPoints);
      this.tempBandPath = this.buildBandPath(this.tempPoints, 8);
    } else if (this.tempPoints.length === 1) {
      this.tempLinePath = '';
      this.tempBandPath = '';
    } else {
      this.tempLinePath = '';
      this.tempBandPath = '';
    }
  }

  /** Convert a temperature value to a Y offset from bottom in px */
  tempToY(temp: number): number {
    const range = this.tempMax - this.tempMin || 1;
    const margin = 10; // top/bottom margin in px
    return margin + ((temp - this.tempMin) / range) * (CHART_H - 2 * margin);
  }

  // ── Precipitation ──────────────────────────────────────────
  private calcPrecipData(): void {
    const vals = this.hours
      .map(h => h.precipitation)
      .filter((v): v is number => v !== undefined && v > 0);
    this.precipMax = Math.max(1, ...vals);

    this.precipBars = [];
    for (let i = 0; i < this.hours.length; i++) {
      const p = this.hours[i].precipitation;
      if (!p || p <= 0) continue;
      const barH = Math.max(2, (p / this.precipMax) * (CHART_H * 0.6));
      const barW = COL_W * 0.5;
      this.precipBars.push({
        x: i * COL_W + (COL_W - barW) / 2,
        y: CHART_H - barH,
        w: barW,
        h: barH,
      });
    }
  }

  // ── Day separators ─────────────────────────────────────────
  private calcDaySeps(): void {
    this.daySepXPositions = [];
    for (let i = 0; i < this.hours.length; i++) {
      if (this.isDayBoundary(i)) {
        this.daySepXPositions.push(i * COL_W);
      }
    }
  }

  // ── Sunshine ──────────────────────────────────────────────
  getSunshineHeight(sunshine?: number): number {
    if (!sunshine || sunshine <= 0) return 0;
    return Math.max(2, (Math.min(sunshine, 60) / 60) * SUNSHINE_H);
  }

  // ── Monotone cubic bezier interpolation ────────────────────
  /**
   * Attempt a Fritsch–Carlson monotone cubic spline.
   * Falls back to simpler Catmull-Rom–like control points.
   */
  private monotoneCubicPath(pts: { x: number; y: number }[]): string {
    const n = pts.length;
    if (n < 2) return '';
    if (n === 2) {
      return `M${pts[0].x},${pts[0].y}L${pts[1].x},${pts[1].y}`;
    }

    // 1) compute finite differences (deltas) and slopes (tangents)
    const dx: number[] = [];
    const dy: number[] = [];
    const m: number[] = []; // tangent at each point

    for (let i = 0; i < n - 1; i++) {
      dx.push(pts[i + 1].x - pts[i].x);
      dy.push(pts[i + 1].y - pts[i].y);
    }

    // slopes of segments
    const slopes: number[] = dx.map((d, i) => (d === 0 ? 0 : dy[i] / d));

    // tangents – three-point formula with Fritsch-Carlson adjustments
    m.push(slopes[0]);
    for (let i = 1; i < n - 1; i++) {
      if (slopes[i - 1] * slopes[i] <= 0) {
        m.push(0);
      } else {
        m.push((slopes[i - 1] + slopes[i]) / 2);
      }
    }
    m.push(slopes[n - 2]);

    // Fritsch-Carlson: ensure monotonicity
    for (let i = 0; i < n - 1; i++) {
      if (slopes[i] === 0) {
        m[i] = 0;
        m[i + 1] = 0;
      } else {
        const alpha = m[i] / slopes[i];
        const beta = m[i + 1] / slopes[i];
        const s = alpha * alpha + beta * beta;
        if (s > 9) {
          const t = 3 / Math.sqrt(s);
          m[i] = t * alpha * slopes[i];
          m[i + 1] = t * beta * slopes[i];
        }
      }
    }

    // 2) Build cubic bezier path
    let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
      const seg = dx[i] / 3;
      const cp1x = pts[i].x + seg;
      const cp1y = pts[i].y + m[i] * seg;
      const cp2x = pts[i + 1].x - seg;
      const cp2y = pts[i + 1].y - m[i + 1] * seg;
      d += `C${cp1x.toFixed(1)},${cp1y.toFixed(1)},${cp2x.toFixed(1)},${cp2y.toFixed(1)},${pts[i + 1].x.toFixed(1)},${pts[i + 1].y.toFixed(1)}`;
    }

    return d;
  }

  /** Build a filled band path ±offset pixels around the temp points */
  private buildBandPath(pts: { x: number; y: number }[], offset: number): string {
    if (pts.length < 2) return '';

    const upper = pts.map(p => ({ x: p.x, y: Math.max(0, p.y - offset) }));
    const lower = pts.map(p => ({ x: p.x, y: Math.min(CHART_H, p.y + offset) }));

    const topPath = this.monotoneCubicPath(upper);
    // Build a reversed lower path (line segments for simplicity to close the area)
    let bottomReverse = '';
    for (let i = lower.length - 1; i >= 0; i--) {
      bottomReverse += `L${lower[i].x.toFixed(1)},${lower[i].y.toFixed(1)}`;
    }
    return topPath + bottomReverse + 'Z';
  }

  // ── Time axis helpers ─────────────────────────────────────
  isDayBoundary(index: number): boolean {
    if (index === 0) return false;
    const prev = this.hours[index - 1];
    const curr = this.hours[index];
    const prevDay = new Date(prev.datetime).toLocaleDateString('en-CH', { timeZone: 'Europe/Zurich' });
    const currDay = new Date(curr.datetime).toLocaleDateString('en-CH', { timeZone: 'Europe/Zurich' });
    return prevDay !== currDay;
  }

  showHourLabel(h: HourlyForecast): boolean {
    const hour = this.getLocalHour(h);
    return hour % 3 === 0;
  }

  formatHour(h: HourlyForecast): string {
    const hour = this.getLocalHour(h);
    return hour.toString().padStart(2, '0');
  }

  formatDayLabel(h: HourlyForecast): string {
    return h.datetime.toLocaleString('en-CH', {
      timeZone: 'Europe/Zurich',
      weekday: 'short',
      day: 'numeric',
      month: 'short'
    });
  }

  private getLocalHour(h: HourlyForecast): number {
    return parseInt(
      h.datetime.toLocaleString('en-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', hour12: false }),
      10
    );
  }

  // ── Daily helpers ──────────────────────────────────────────
  get displayDaily(): DailyForecast[] {
    if (!this.forecast) return [];
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return this.forecast.daily
      .filter(d => d.date >= todayStart)
      .slice(0, 8);
  }

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

  // ── MeteoSwiss weather icon code → emoji ──────────────────
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

  // ── Hover interaction (running outside Angular Zone for 60fps performance) ──
  private setupHoverListeners(el: HTMLElement): void {
    console.log('[ForecastChart] setupHoverListeners for:', el);
    this.ngZone.runOutsideAngular(() => {
      el.addEventListener('mousemove', this.handleMouseMove, { passive: true });
      el.addEventListener('mouseleave', this.handleMouseLeave, { passive: true });
    });
  }

  private cleanupHoverListeners(el: HTMLElement): void {
    console.log('[ForecastChart] cleanupHoverListeners for:', el);
    el.removeEventListener('mousemove', this.handleMouseMove);
    el.removeEventListener('mouseleave', this.handleMouseLeave);
  }

  ngOnDestroy(): void {
    if (this.chartContentEl) {
      this.cleanupHoverListeners(this.chartContentEl);
    }
  }

  private handleMouseMove = (event: MouseEvent): void => {
    if (!this.chartContentEl) return;
    const rect = this.chartContentEl.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const index = Math.max(0, Math.min(this.hours.length - 1, Math.floor(x / COL_W)));
    
    console.log('[ForecastChart] handleMouseMove index:', index, 'current hovered:', this.hoveredHourIndex);
    if (index !== this.hoveredHourIndex) {
      console.log('[ForecastChart] Emit hover index:', index);
      this.ngZone.run(() => {
        this.hoverChanged.emit(index);
      });
    }
  };

  private handleMouseLeave = (): void => {
    console.log('[ForecastChart] handleMouseLeave');
    if (this.hoveredHourIndex !== null) {
      this.ngZone.run(() => {
        this.hoverChanged.emit(null);
      });
    }
  };

  getHoveredPoint(): { x: number; y: number } | null {
    if (this.hoveredHourIndex === null) return null;
    const pt = this.tempPoints.find(p => p.index === this.hoveredHourIndex);
    return pt || null;
  }
}
