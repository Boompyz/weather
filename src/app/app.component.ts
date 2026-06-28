import { Component, inject, ViewChild, Renderer2, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MapComponent } from './map/map.component';
import { StationPanelComponent } from './station-panel/station-panel.component';
import { WeatherService, StationForecast } from './weather.service';
import { switchMap, tap, catchError } from 'rxjs/operators';
import { Subject, of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, MapComponent, StationPanelComponent],
  template: `
    <div class="app-layout" [class.resizing]="isResizing">
      <div class="map-section">
        <app-map
          #mapComp
          [initialLat]="clickedLat"
          [initialLon]="clickedLon"
          (locationSelected)="onLocationSelected($event)">
        </app-map>
      </div>

      <!-- Drag handle -->
      <div class="resize-handle"
           (mousedown)="startResize($event)"
           (touchstart)="startResizeTouch($event)">
        <div class="handle-grip">
          <span></span><span></span><span></span>
        </div>
      </div>

      <div class="panel-section" [style.width.px]="panelWidth">
        <app-station-panel
          [forecasts]="forecasts"
          [isLoading]="isLoading"
          [clickedLat]="clickedLat"
          [clickedLon]="clickedLon">
        </app-station-panel>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100vh; overflow: hidden; }
    .app-layout {
      display: flex;
      height: 100%;
      background: var(--bg-primary);
    }
    .app-layout.resizing { cursor: col-resize; user-select: none; }
    .app-layout.resizing * { pointer-events: none; }
    .app-layout.resizing .resize-handle { pointer-events: all; }
    .map-section {
      flex: 1;
      width: 0;
      position: relative;
      transform: translateZ(0);
      will-change: transform;
    }
    .panel-section {
      flex-shrink: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      min-width: 320px;
      max-width: 80vw;
      transform: translateZ(0);
      will-change: transform;
    }

    /* ── Resize handle ────────────────── */
    .resize-handle {
      width: 8px;
      cursor: col-resize;
      background: var(--bg-secondary);
      border-left: 1px solid var(--border-subtle);
      border-right: 1px solid var(--border-subtle);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.15s;
      z-index: 10;
    }
    .resize-handle:hover,
    .app-layout.resizing .resize-handle {
      background: rgba(88, 166, 255, 0.15);
      border-left-color: rgba(88, 166, 255, 0.4);
      border-right-color: rgba(88, 166, 255, 0.4);
    }
    .handle-grip {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .handle-grip span {
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: var(--text-muted);
      transition: background 0.15s;
    }
    .resize-handle:hover .handle-grip span,
    .app-layout.resizing .handle-grip span {
      background: var(--accent-blue);
    }

    @media (max-width: 900px) {
      .app-layout { flex-direction: column; }
      .map-section { height: 50vh; flex: none; }
      .resize-handle { display: none; }
      .panel-section {
        width: 100% !important;
        height: 50vh;
        min-width: 0;
        max-width: none;
        border-top: 1px solid var(--border-subtle);
      }
    }
  `]
})
export class AppComponent {
  @ViewChild('mapComp') mapComp!: MapComponent;

  private weatherService = inject(WeatherService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private ngZone = inject(NgZone);
  private renderer = inject(Renderer2);

  forecasts: StationForecast[] = [];
  isLoading = false;
  clickedLat: number | null = null;
  clickedLon: number | null = null;

  // Panel resize state
  panelWidth = 520;
  isResizing = false;
  private startX = 0;
  private startWidth = 0;

  private locationSubject = new Subject<{ lat: number; lon: number }>();

  constructor() {
    // Load saved panel width from localStorage
    const saved = localStorage.getItem('weather-panel-width');
    if (saved) this.panelWidth = Math.max(320, Math.min(parseInt(saved), window.innerWidth * 0.8));

    // Handle deep linked coordinates from URL on load
    this.route.queryParams.subscribe(params => {
      const lat = parseFloat(params['lat']);
      const lon = parseFloat(params['lon']);
      if (!isNaN(lat) && !isNaN(lon)) {
        // Only trigger update if values are different from current selection
        if (this.clickedLat === null || this.clickedLon === null ||
            Math.abs(this.clickedLat - lat) > 0.0001 ||
            Math.abs(this.clickedLon - lon) > 0.0001) {
          this.clickedLat = lat;
          this.clickedLon = lon;
          this.locationSubject.next({ lat, lon });

          // If map has loaded, programmatically update it
          if (this.mapComp) {
            this.mapComp.selectCoordinate(lat, lon);
          }
        }
      }
    });

    this.locationSubject.pipe(
      switchMap(({ lat, lon }) =>
        this.weatherService.getNearbyStations(lat, lon, 5, 80).pipe(
          tap(stations => setTimeout(() => this.mapComp?.showStations(stations), 0)),
          switchMap(stations => {
            const cached = this.weatherService.getCachedForecasts(stations);
            if (cached) {
              this.forecasts = cached;
              this.isLoading = false;

              // Check if cache is fresh (less than 15 minutes old). If so, skip background revalidation
              const ageMs = Date.now() - new Date(cached[0]?.fetchedAt || Date.now()).getTime();
              if (ageMs < 15 * 60 * 1000) {
                return of(cached as StationForecast[]);
              }

              // Silently revalidate in background
              return this.weatherService.getForecastsForStations(stations).pipe(
                tap(fresh => this.weatherService.saveForecastsToCache(stations, fresh)),
                catchError(err => {
                  console.warn('Background revalidation failed:', err);
                  return of(cached as StationForecast[]);
                })
              );
            } else {
              // Cold load: show spinner and clear old forecasts
              this.isLoading = true;
              this.forecasts = [];

              return this.weatherService.getForecastsForStations(stations).pipe(
                tap(fresh => this.weatherService.saveForecastsToCache(stations, fresh)),
                catchError(err => {
                  console.error('Cold load fetch failed:', err);
                  return of([]);
                })
              );
            }
          })
        )
      ),
      takeUntilDestroyed()
    ).subscribe({
      next: forecasts => { this.forecasts = forecasts; this.isLoading = false; },
      error: err => { console.error('Forecast error:', err); this.isLoading = false; }
    });
  }

  onLocationSelected(loc: { lat: number; lon: number }): void {
    this.clickedLat = loc.lat;
    this.clickedLon = loc.lon;
    this.locationSubject.next(loc);

    // Update query params in address bar for shareability
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { lat: loc.lat.toFixed(4), lon: loc.lon.toFixed(4) },
      queryParamsHandling: 'merge'
    });
  }

  // Panel resize listeners
  private resizeMouseMoveListener?: () => void;
  private resizeMouseUpListener?: () => void;

  // ── Resize logic ──
  startResize(event: MouseEvent): void {
    event.preventDefault();
    this.isResizing = true;
    this.startX = event.clientX;
    this.startWidth = this.panelWidth;

    this.ngZone.runOutsideAngular(() => {
      this.resizeMouseMoveListener = this.renderer.listen('window', 'mousemove', (e: MouseEvent) => {
        const dx = this.startX - e.clientX;
        const newWidth = Math.max(320, Math.min(this.startWidth + dx, window.innerWidth * 0.8));
        if (newWidth !== this.panelWidth) {
          this.ngZone.run(() => {
            this.panelWidth = newWidth;
          });
        }
      });

      this.resizeMouseUpListener = this.renderer.listen('window', 'mouseup', () => {
        this.ngZone.run(() => {
          this.isResizing = false;
          localStorage.setItem('weather-panel-width', String(this.panelWidth));
          setTimeout(() => this.mapComp?.map?.updateSize(), 50);
        });
        this.cleanupResizeListeners();
      });
    });
  }

  startResizeTouch(event: TouchEvent): void {
    this.isResizing = true;
    this.startX = event.touches[0].clientX;
    this.startWidth = this.panelWidth;

    this.ngZone.runOutsideAngular(() => {
      this.resizeMouseMoveListener = this.renderer.listen('window', 'touchmove', (e: TouchEvent) => {
        const dx = this.startX - event.touches[0].clientX;
        const newWidth = Math.max(320, Math.min(this.startWidth + dx, window.innerWidth * 0.8));
        if (newWidth !== this.panelWidth) {
          this.ngZone.run(() => {
            this.panelWidth = newWidth;
          });
        }
      });

      this.resizeMouseUpListener = this.renderer.listen('window', 'touchend', () => {
        this.ngZone.run(() => {
          this.isResizing = false;
          localStorage.setItem('weather-panel-width', String(this.panelWidth));
          setTimeout(() => this.mapComp?.map?.updateSize(), 50);
        });
        this.cleanupResizeListeners();
      });
    });
  }

  private cleanupResizeListeners(): void {
    if (this.resizeMouseMoveListener) {
      this.resizeMouseMoveListener();
      this.resizeMouseMoveListener = undefined;
    }
    if (this.resizeMouseUpListener) {
      this.resizeMouseUpListener();
      this.resizeMouseUpListener = undefined;
    }
  }
}
