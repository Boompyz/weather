import {
  Component, EventEmitter, Output, ViewChild, ViewChildren,
  QueryList, ElementRef, inject, OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { debounceTime, switchMap, distinctUntilChanged, map } from 'rxjs/operators';
import { of, Subscription } from 'rxjs';

export interface AutocompleteResult {
  text: string;
  htmlText: string;
  type: string;
  lon: number;
  lat: number;
  z: number;
}

@Component({
  selector: 'app-search-bar',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="search-container">
      <div class="search-input-wrap" [class.focused]="focused" [class.has-value]="!!searchControl.value">
        <span class="material-icons search-icon">search</span>
        <input
          #inputEl
          type="text"
          id="location-search"
          autocomplete="off"
          spellcheck="false"
          [formControl]="searchControl"
          placeholder="Search Swiss locations…"
          (keydown)="onKeyDown($event)"
          (focus)="onFocus()"
          (blur)="onBlur()"
          class="search-input"
        />
        <button class="clear-btn" *ngIf="searchControl.value" (click)="clear()" tabindex="-1" aria-label="Clear">
          <span class="material-icons">close</span>
        </button>
        <div class="loading-dot" *ngIf="isLoading"></div>
      </div>

      <!-- Dropdown -->
      <div class="autocomplete-dropdown" *ngIf="showDropdown && results.length > 0" #dropdown>
        <div
          *ngFor="let result of results; let i = index"
          class="autocomplete-item"
          [class.selected]="i === selectedIndex"
          (mousedown)="selectResult(result)"
          (mouseenter)="onItemHover(i)"
          #item>
          <span class="material-icons item-icon">{{ getIcon(result.type) }}</span>
          <span class="item-text" [innerHTML]="result.htmlText"></span>
          <span class="item-type">{{ result.type }}</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .search-container {
      position: relative;
      width: 100%;
      max-width: 400px;
    }

    /* ── Input wrapper ── */
    .search-input-wrap {
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(22, 27, 34, 0.92);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 10px;
      padding: 0 10px;
      height: 40px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.3);
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .search-input-wrap.focused {
      border-color: rgba(88, 166, 255, 0.6);
      box-shadow: 0 4px 16px rgba(0,0,0,0.4), 0 0 0 3px rgba(88,166,255,0.12);
    }

    .search-icon {
      font-size: 17px;
      color: #6e7681;
      flex-shrink: 0;
      transition: color 0.2s;
    }
    .search-input-wrap.focused .search-icon { color: #58a6ff; }

    .search-input {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      color: #e6edf3;
      min-width: 0;
    }
    .search-input::placeholder { color: #6e7681; }

    .clear-btn {
      background: transparent;
      border: none;
      cursor: pointer;
      color: #6e7681;
      display: flex;
      align-items: center;
      padding: 2px;
      border-radius: 4px;
      transition: color 0.15s, background 0.15s;
      flex-shrink: 0;
    }
    .clear-btn:hover { color: #e6edf3; background: rgba(255,255,255,0.08); }
    .clear-btn .material-icons { font-size: 16px; }

    .loading-dot {
      width: 16px;
      height: 16px;
      border: 2px solid rgba(88,166,255,0.3);
      border-top-color: #58a6ff;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      flex-shrink: 0;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Dropdown ── */
    .autocomplete-dropdown {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      right: 0;
      background: rgba(22, 27, 34, 0.98);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4);
      z-index: 1000;
      max-height: 280px;
      overflow-y: auto;
      animation: dropIn 0.15s ease;
    }
    @keyframes dropIn {
      from { opacity: 0; transform: translateY(-6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .autocomplete-dropdown::-webkit-scrollbar { width: 4px; }
    .autocomplete-dropdown::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.1);
      border-radius: 4px;
    }

    .autocomplete-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 9px 12px;
      cursor: pointer;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      transition: background 0.12s;
    }
    .autocomplete-item:last-child { border-bottom: none; }
    .autocomplete-item:first-child { border-radius: 10px 10px 0 0; }
    .autocomplete-item:last-child { border-radius: 0 0 10px 10px; }
    .autocomplete-item:first-child:last-child { border-radius: 10px; }

    .autocomplete-item:hover,
    .autocomplete-item.selected {
      background: rgba(88, 166, 255, 0.12);
    }
    .autocomplete-item.selected { background: rgba(88, 166, 255, 0.18); }

    .item-icon {
      font-size: 15px;
      color: #58a6ff;
      flex-shrink: 0;
      opacity: 0.8;
    }
    .item-text {
      flex: 1;
      font-size: 12.5px;
      color: #e6edf3;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    /* Bold the matched text that the API wraps in <b> */
    .item-text :global(b) { color: #58a6ff; font-weight: 700; }
    .item-type {
      font-size: 10px;
      color: #6e7681;
      flex-shrink: 0;
      text-transform: capitalize;
    }
  `]
})
export class SearchBarComponent implements OnDestroy {
  @Output() locationSelected = new EventEmitter<AutocompleteResult>();
  @Output() locationPreview  = new EventEmitter<AutocompleteResult | null>();

  @ViewChild('dropdown') dropdownEl!: ElementRef;
  @ViewChildren('item')  items!: QueryList<ElementRef>;
  @ViewChild('inputEl')  inputEl!: ElementRef<HTMLInputElement>;

  private http = inject(HttpClient);

  searchControl = new FormControl('');
  results: AutocompleteResult[] = [];
  selectedIndex = -1;
  showDropdown = false;
  focused = false;
  isLoading = false;

  private sub: Subscription;

  constructor() {
    this.sub = this.searchControl.valueChanges.pipe(
      debounceTime(280),
      distinctUntilChanged(),
      switchMap(value => {
        if (!value || value.length < 2) {
          this.isLoading = false;
          return of([]);
        }
        this.isLoading = true;
        return this.http.get<any>(
          `https://api3.geo.admin.ch/rest/services/api/SearchServer` +
          `?searchText=${encodeURIComponent(value)}&type=locations&sr=2056&lang=en`
        ).pipe(
          map(res => res.results.map((r: any) => ({
            text:     r.attrs.label.replace(/<[^>]*>/g, ''),
            htmlText: r.attrs.label,
            type:     r.attrs.origin,
            lon:      r.attrs.lon,
            lat:      r.attrs.lat,
            z:        r.attrs.zoomlevel ?? 14
          })))
        );
      })
    ).subscribe({
      next: results => {
        this.results = results;
        this.selectedIndex = -1;
        this.isLoading = false;
        this.showDropdown = results.length > 0 && this.focused;
        this.locationPreview.emit(null);
      },
      error: () => { this.isLoading = false; }
    });
  }

  onFocus(): void {
    this.focused = true;
    if (this.results.length > 0) this.showDropdown = true;
  }

  onBlur(): void {
    this.focused = false;
    // Delay to let mousedown on item fire first
    setTimeout(() => { this.showDropdown = false; }, 200);
  }

  onItemHover(i: number): void {
    this.selectedIndex = i;
    this.locationPreview.emit(this.results[i]);
  }

  onKeyDown(event: KeyboardEvent): void {
    if (!this.showDropdown || this.results.length === 0) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.selectedIndex = (this.selectedIndex + 1) % this.results.length;
        this.scrollToSelected();
        this.locationPreview.emit(this.results[this.selectedIndex]);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.selectedIndex = (this.selectedIndex - 1 + this.results.length) % this.results.length;
        this.scrollToSelected();
        this.locationPreview.emit(this.results[this.selectedIndex]);
        break;
      case 'Enter':
        if (this.selectedIndex >= 0) this.selectResult(this.results[this.selectedIndex]);
        break;
      case 'Escape':
        this.showDropdown = false;
        this.locationPreview.emit(null);
        break;
    }
  }

  selectResult(result: AutocompleteResult): void {
    this.locationSelected.emit(result);
    this.searchControl.setValue(result.text, { emitEvent: false });
    this.showDropdown = false;
    this.selectedIndex = -1;
    this.locationPreview.emit(null);
  }

  clear(): void {
    this.searchControl.setValue('');
    this.results = [];
    this.showDropdown = false;
    this.locationPreview.emit(null);
    this.inputEl.nativeElement.focus();
  }

  getIcon(type: string): string {
    switch (type) {
      case 'gg25':     return 'location_city';
      case 'sn25':     return 'landscape';
      case 'gazetteer': return 'place';
      case 'address':  return 'home';
      case 'parcel':   return 'grid_on';
      default:         return 'pin_drop';
    }
  }

  scrollToSelected(): void {
    if (!this.items || !this.dropdownEl || this.selectedIndex < 0) return;
    const arr = this.items.toArray();
    if (this.selectedIndex >= arr.length) return;
    const item = arr[this.selectedIndex].nativeElement;
    const drop = this.dropdownEl.nativeElement;
    if (item.offsetTop + item.offsetHeight > drop.scrollTop + drop.offsetHeight) {
      drop.scrollTop = item.offsetTop + item.offsetHeight - drop.offsetHeight;
    } else if (item.offsetTop < drop.scrollTop) {
      drop.scrollTop = item.offsetTop;
    }
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}
