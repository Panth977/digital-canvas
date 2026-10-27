/**
 * Editor view options (not part of the design): rulers and guides, print
 * bleed, safe margins, snapping. Remembered in this browser.
 *
 * Also the viewport's zoom, shared by the canvas, the bottom bar and the
 * keyboard shortcuts. The canvas registers itself as `port` and does the work.
 */
const KEY = 'dc:view';

interface Prefs { rulers: boolean; bleed: boolean; margins: boolean; snap: boolean }

/** Canva's zoom range. */
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 5;
/** Levels ⌘+ / ⌘− step through (Canva). */
export const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5];
/** Canva's zoom menu (click on the % readout), above Fit and Fill. */
export const ZOOM_PRESETS = [3, 2, 1.25, 1, 0.75, 0.5, 0.25, 0.1];

export type FitMode = 'fit' | 'fill';

/** The next zoom step up (dir 1) or down (dir -1) from z. */
export function stepZoom(z: number, dir: 1 | -1): number {
  const eps = 1e-3;
  if (dir > 0) return ZOOM_STEPS.find((s) => s > z + eps) ?? ZOOM_MAX;
  return [...ZOOM_STEPS].reverse().find((s) => s < z - eps) ?? ZOOM_MIN;
}

export const clampZoom = (z: number): number => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

/** What the canvas does for the view commands. */
export interface ViewPort {
  /** Zoom around the middle of the workspace. */
  zoomTo(z: number): void;
  /** Fit the current page in the workspace, or fill its width (Canva's Fit / Fill). */
  fit(mode: FitMode): void;
  /** Make page i current and scroll it into view. */
  goToPage(i: number): void;
}

class View {
  rulers = $state(false);
  bleed = $state(false);
  margins = $state(false);
  snap = $state(true);

  /** Current zoom (1 = 100%). Written by the canvas. */
  zoom = $state(1);
  /** Fit / Fill keep re-fitting on resize until the user zooms (Canva). */
  mode = $state<FitMode | null>('fit');
  port: ViewPort | null = null;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
      for (const k of ['rulers', 'bleed', 'margins', 'snap'] as const) if (typeof saved[k] === 'boolean') this[k] = saved[k];
    } catch {
      // nothing saved, or storage blocked
    }
  }

  toggle(k: keyof Prefs): void {
    this[k] = !this[k];
    try {
      localStorage.setItem(KEY, JSON.stringify({ rulers: this.rulers, bleed: this.bleed, margins: this.margins, snap: this.snap }));
    } catch {
      // storage blocked: the choice lasts for this session
    }
  }

  zoomTo(z: number): void { this.port?.zoomTo(clampZoom(z)); }
  zoomIn(): void { this.zoomTo(stepZoom(this.zoom, 1)); }
  zoomOut(): void { this.zoomTo(stepZoom(this.zoom, -1)); }
  fit(mode: FitMode = 'fit'): void { this.port?.fit(mode); }
  goToPage(i: number): void { this.port?.goToPage(i); }
}

export const view = new View();
