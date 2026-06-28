import {
  Component, AfterViewInit, OnDestroy, Output, EventEmitter, inject, NgZone, Input
} from '@angular/core';
import { CommonModule } from '@angular/common';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { SearchBarComponent, AutocompleteResult } from '../search-bar/search-bar.component';
import { Style, Circle, Fill, Stroke, Icon, Text } from 'ol/style';
import { XYZ } from 'ol/source';
import { easeOut } from 'ol/easing';
import { MapBrowserEvent } from 'ol';
import { transform } from 'ol/proj';
import { fromLonLat, toLonLat } from 'ol/proj';
import proj4 from 'proj4';
import { register } from 'ol/proj/proj4';
import { WeatherStation } from '../weather.service';
import { Coordinate } from 'ol/coordinate';

proj4.defs('EPSG:2056',
  '+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 ' +
  '+k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel ' +
  '+towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs'
);
register(proj4);

@Component({
  selector: 'app-map',
  standalone: true,
  imports: [CommonModule, SearchBarComponent],
  template: `
    <div class="map-wrap">
      <div id="weather-map" class="map"></div>

      <!-- Search bar overlay -->
      <div class="search-overlay">
        <app-search-bar
          (locationSelected)="onSearchSelected($event)"
          (locationPreview)="onSearchPreview($event)">
        </app-search-bar>
      </div>

      <!-- Map style toggle -->
      <div class="map-controls">
        <button class="ctrl-btn" [class.active]="activeLayer === 'colour'"
                (click)="setLayer('colour')" title="Colour map">🗺️</button>
        <button class="ctrl-btn" [class.active]="activeLayer === 'satellite'"
                (click)="setLayer('satellite')" title="Satellite">🛰️</button>
        <button class="ctrl-btn" [class.active]="activeLayer === 'bw'"
                (click)="setLayer('bw')" title="Greyscale">⬛</button>
      </div>

      <!-- Click hint -->
      <div class="click-hint" *ngIf="!hasClicked">
        <span class="material-icons">touch_app</span>
        Click anywhere on Switzerland to load nearby weather stations
      </div>
    </div>
  `,
  styles: [`
    .map-wrap {
      position: relative;
      width: 100%;
      height: 100%;
    }
    .map {
      width: 100%;
      height: 100%;
      cursor: crosshair;
      background: #0d1117;
    }
    .search-overlay {
      position: absolute;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      width: min(400px, calc(100% - 130px));
      z-index: 20;
    }
    .map-controls {
      position: absolute;
      top: 12px;
      left: 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      z-index: 10;
    }
    .ctrl-btn {
      width: 36px;
      height: 36px;
      background: rgba(22,27,34,0.9);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 8px;
      cursor: pointer;
      font-size: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
      color: #e6edf3;
    }
    .ctrl-btn:hover {
      background: rgba(88,166,255,0.15);
      border-color: rgba(88,166,255,0.5);
      transform: scale(1.05);
    }
    .ctrl-btn.active {
      background: rgba(88,166,255,0.2);
      border-color: rgba(88,166,255,0.7);
      box-shadow: 0 0 12px rgba(88,166,255,0.2);
    }
    .click-hint {
      position: absolute;
      bottom: 60px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(22,27,34,0.9);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 24px;
      padding: 8px 18px;
      font-size: 13px;
      color: #8b949e;
      display: flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
      pointer-events: none;
      transition: opacity 0.5s, transform 0.5s;
      z-index: 10;
    }
    .click-hint .material-icons {
      font-size: 16px;
      color: #58a6ff;
      animation: pulse 2s infinite;
    }
    .click-hint.hidden {
      opacity: 0;
      transform: translateX(-50%) translateY(10px);
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
  `]
})
export class MapComponent implements AfterViewInit, OnDestroy {
  @Input() initialLat: number | null = null;
  @Input() initialLon: number | null = null;
  @Output() locationSelected = new EventEmitter<{ lat: number; lon: number }>();
  @Output() stationsUpdated  = new EventEmitter<WeatherStation[]>();

  private ngZone = inject(NgZone);

  map!: Map;
  hasClicked = false;
  activeLayer: 'colour' | 'bw' | 'satellite' = 'colour';

  private selectedMarkerSource = new VectorSource();
  private stationMarkerSource  = new VectorSource();
  private previewMarkerSource  = new VectorSource();
  private bwLayer!: TileLayer<XYZ>;
  private colourLayer!: TileLayer<XYZ>;
  private satelliteLayer!: TileLayer<XYZ>;

  ngAfterViewInit(): void {
    this.ngZone.runOutsideAngular(() => this.initMap());
  }

  private tileLoadFn = (tile: any, src: string) => {
    tile.getImage().src = src.replace(
      '{z}/{x}/{y}',
      `${tile.getTileCoord()[0]}/${tile.getTileCoord()[1]}/${tile.getTileCoord()[2]}`
    );
  };

  private initMap(): void {
    this.bwLayer = new TileLayer({
      source: new XYZ({
        url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg',
        tileLoadFunction: this.tileLoadFn,
        crossOrigin: 'anonymous'
      }),
      visible: false, maxZoom: 20
    });

    this.colourLayer = new TileLayer({
      source: new XYZ({
        url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg',
        tileLoadFunction: this.tileLoadFn,
        crossOrigin: 'anonymous'
      }),
      visible: true, maxZoom: 20
    });

    this.satelliteLayer = new TileLayer({
      source: new XYZ({
        url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg',
        tileLoadFunction: this.tileLoadFn,
        crossOrigin: 'anonymous'
      }),
      visible: false, maxZoom: 20
    });

    const hasInitial = this.initialLat !== null && this.initialLon !== null;
    const initialCenter = hasInitial
      ? fromLonLat([this.initialLon!, this.initialLat!])
      : fromLonLat([8.23, 46.82]);
    const initialZoom = hasInitial ? 11 : 8;

    this.map = new Map({
      target: 'weather-map',
      layers: [
        this.bwLayer,
        this.colourLayer,
        this.satelliteLayer,
        new VectorLayer({ source: this.stationMarkerSource }),
        new VectorLayer({ source: this.previewMarkerSource }),
        new VectorLayer({ source: this.selectedMarkerSource }),
      ],
      view: new View({
        center: initialCenter,
        zoom: initialZoom,
        minZoom: 7,
        maxZoom: 20,
        extent: fromLonLat([5.0, 44.5]).concat(fromLonLat([11.5, 48.5])) as any
      })
    });

    if (hasInitial) {
      this.hasClicked = true;
      this.placeSelectedMarker(initialCenter);
    }

    this.map.on('click', (evt: MapBrowserEvent<any>) => {
      const lonLat = toLonLat(evt.coordinate);
      this.ngZone.run(() => {
        this.hasClicked = true;
        this.placeSelectedMarker(evt.coordinate);
        this.locationSelected.emit({ lat: lonLat[1], lon: lonLat[0] });
      });
    });
  }

  /** Called when a search result is selected — fly to it and trigger station load */
  onSearchSelected(result: AutocompleteResult): void {
    this.ngZone.runOutsideAngular(() => {
      this.previewMarkerSource.clear();
      const coord = fromLonLat([result.lon, result.lat]);
      this.map.getView().animate({
        center: coord,
        zoom: Math.min(result.z, 14),
        duration: 800,
        easing: easeOut
      });
      this.ngZone.run(() => {
        this.hasClicked = true;
        this.placeSelectedMarker(coord);
        this.locationSelected.emit({ lat: result.lat, lon: result.lon });
      });
    });
  }

  /** Show a preview pin while hovering a search result */
  onSearchPreview(result: AutocompleteResult | null): void {
    this.ngZone.runOutsideAngular(() => {
      this.previewMarkerSource.clear();
      if (!result) return;
      const coord = fromLonLat([result.lon, result.lat]);
      const pinSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
        <path fill="#39d0f5" stroke="#0d1117" stroke-width="1.5"
          d="M14 2C8.48 2 4 6.48 4 12c0 7 10 22 10 22s10-15 10-22c0-5.52-4.48-10-10-10z"/>
        <circle cx="14" cy="12" r="4" fill="white" opacity="0.9"/>
      </svg>`;
      const pin = new Feature({ geometry: new Point(coord) });
      pin.setStyle(new Style({
        image: new Icon({
          src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(pinSvg),
          anchor: [0.5, 1],
          scale: 1.1
        })
      }));
      this.previewMarkerSource.addFeature(pin);
    });
  }

  selectCoordinate(lat: number, lon: number): void {
    this.ngZone.runOutsideAngular(() => {
      if (!this.map) return;
      const coord = fromLonLat([lon, lat]);
      this.hasClicked = true;
      this.placeSelectedMarker(coord);
      this.map.getView().animate({
        center: coord,
        zoom: 11,
        duration: 500,
        easing: easeOut
      });
    });
  }

  setLayer(layer: 'colour' | 'bw' | 'satellite'): void {
    this.activeLayer = layer;
    this.ngZone.runOutsideAngular(() => {
      this.bwLayer.setVisible(layer === 'bw');
      this.colourLayer.setVisible(layer === 'colour');
      this.satelliteLayer.setVisible(layer === 'satellite');
    });
  }

  placeSelectedMarker(coord: Coordinate): void {
    this.ngZone.runOutsideAngular(() => {
      this.selectedMarkerSource.clear();
      // Ripple ring
      const ring = new Feature({ geometry: new Point(coord) });
      ring.setStyle(new Style({
        image: new Circle({
          radius: 18,
          fill: new Fill({ color: 'rgba(88,166,255,0.12)' }),
          stroke: new Stroke({ color: 'rgba(88,166,255,0.6)', width: 2 })
        })
      }));
      // Centre dot
      const dot = new Feature({ geometry: new Point(coord) });
      dot.setStyle(new Style({
        image: new Circle({
          radius: 7,
          fill: new Fill({ color: '#58a6ff' }),
          stroke: new Stroke({ color: '#ffffff', width: 2 })
        })
      }));
      this.selectedMarkerSource.addFeature(ring);
      this.selectedMarkerSource.addFeature(dot);
    });
  }

  showStations(stations: WeatherStation[]): void {
    this.ngZone.runOutsideAngular(() => {
      this.stationMarkerSource.clear();
      stations.forEach((s, i) => {
        const coord = fromLonLat([s.lon, s.lat]);
        const feature = new Feature({ geometry: new Point(coord) });

        // Color by distance rank
        const colors = ['#f0c000', '#3fb950', '#58a6ff', '#bc8cff', '#f85149'];
        const color = colors[i] ?? '#8b949e';

        feature.setStyle(new Style({
          image: new Circle({
            radius: 9,
            fill: new Fill({ color }),
            stroke: new Stroke({ color: '#0d1117', width: 2 })
          }),
          text: new Text({
            text: s.station_abbr,
            offsetY: -18,
            font: 'bold 11px Inter, sans-serif',
            fill: new Fill({ color }),
            stroke: new Stroke({ color: 'rgba(13,17,23,0.9)', width: 3 })
          })
        }));
        this.stationMarkerSource.addFeature(feature);
      });
    });
  }

  ngOnDestroy(): void {
    this.map?.setTarget(undefined);
  }
}
