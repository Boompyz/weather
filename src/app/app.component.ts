import { Component, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { MapComponent } from './map/map.component';
import { StationPanelComponent } from './station-panel/station-panel.component';
import { WeatherService, StationForecast, WeatherStation } from './weather.service';
import { switchMap, tap } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, MapComponent, StationPanelComponent],
  template: `
    <div class="app-layout">
      <!-- Left: Map -->
      <div class="map-section">
        <app-map
          #mapComp
          (locationSelected)="onLocationSelected($event)">
        </app-map>
      </div>

      <!-- Right: Station Panel -->
      <div class="panel-section" [class.panel-loading]="isLoading">
        <app-station-panel
          [forecasts]="forecasts"
          [isLoading]="isLoading"
          [clickedLat]="clickedLat"
          [clickedLon]="clickedLon"
          [aiText]="aiText"
          (aiTextRequested)="copyAiText()">
        </app-station-panel>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100vh;
      overflow: hidden;
    }
    .app-layout {
      display: flex;
      height: 100%;
      background: var(--bg-primary);
    }
    .map-section {
      flex: 1;
      min-width: 0;
      position: relative;
    }
    .panel-section {
      width: var(--panel-width);
      flex-shrink: 0;
      border-left: 1px solid var(--border-subtle);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    @media (max-width: 900px) {
      .app-layout { flex-direction: column; }
      .map-section { height: 50vh; }
      .panel-section {
        width: 100%;
        height: 50vh;
        border-left: none;
        border-top: 1px solid var(--border-subtle);
      }
    }
  `]
})
export class AppComponent {
  @ViewChild('mapComp') mapComp!: MapComponent;

  private weatherService = inject(WeatherService);

  forecasts: StationForecast[] = [];
  isLoading = false;
  clickedLat: number | null = null;
  clickedLon: number | null = null;
  aiText = '';

  private locationSubject = new Subject<{ lat: number; lon: number }>();

  constructor() {
    this.locationSubject.pipe(
      tap(() => {
        this.isLoading = true;
        this.forecasts = [];
        this.aiText = '';
      }),
      switchMap(({ lat, lon }) =>
        this.weatherService.getNearbyStations(lat, lon, 5, 80).pipe(
          tap(stations => {
            setTimeout(() => this.mapComp?.showStations(stations), 0);
          }),
          switchMap(stations => this.weatherService.getForecastsForStations(stations))
        )
      ),
      takeUntilDestroyed()
    ).subscribe({
      next: forecasts => {
        this.forecasts = forecasts;
        this.isLoading = false;
      },
      error: err => {
        console.error('Forecast error:', err);
        this.isLoading = false;
      }
    });
  }

  onLocationSelected(loc: { lat: number; lon: number }): void {
    this.clickedLat = loc.lat;
    this.clickedLon = loc.lon;
    this.locationSubject.next(loc);
  }

  copyAiText(): void {
    if (!this.forecasts.length || this.clickedLat === null || this.clickedLon === null) return;
    const text = this.weatherService.generateAiText(this.forecasts, this.clickedLat, this.clickedLon);
    this.aiText = text;
    this.writeToClipboard(text);
  }

  private writeToClipboard(text: string): void {
    // navigator.clipboard is only available in secure contexts (HTTPS or localhost).
    // On plain HTTP (LAN) it is undefined, so we must guard before calling it —
    // a synchronous undefined.writeText() throw is NOT caught by Promise.catch().
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(() => this.execCommandCopy(text));
    } else {
      this.execCommandCopy(text);
    }
  }

  private execCommandCopy(text: string): void {
    const ta = document.createElement('textarea');
    ta.value = text;
    // Keep it off-screen and invisible so it doesn't cause layout shift
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); } catch { /* best-effort */ }
    document.body.removeChild(ta);
  }
}
