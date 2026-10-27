/**
 * Editor chrome state (not part of the design): which left-hand panel is
 * open, the colour being picked, popovers. Canva keeps one side panel: the
 * rail sections (Elements, Text, …) and the contextual panels opened from
 * the toolbar (Font, Effects, Position, Colour, …) take turns in it.
 */

export type RailTab = 'elements' | 'text' | 'uploads' | 'draw' | 'photos';
export type ToolPanel = 'font' | 'color' | 'effects' | 'position' | 'image' | 'table' | 'chart' | 'qr' | 'frame' | 'audio';
export type Panel = RailTab | ToolPanel;

export const RAIL_TABS: readonly RailTab[] = ['elements', 'text', 'uploads', 'draw', 'photos'];

/** What the colour panel edits. `value` is read each time, so it follows undo and dragging. */
export interface ColorTarget {
  title: string;
  value: () => string;
  onchange: (hex: string) => void;
  onend: () => void;
  testid?: string;
  /** Selection when it was opened: the panel closes once that changes. */
  owner: string;
  kind?: 'text' | 'fill' | 'page' | 'other';
}

class UI {
  panel = $state<Panel | null>('elements');
  /** The rail section to go back to when a contextual panel closes. */
  lastRail = $state<RailTab>('elements');
  color = $state.raw<ColorTarget | null>(null);
  positionTab = $state<'arrange' | 'layers'>('arrange');
  /** Search text handed to the font panel (Text panel search). */
  fontQuery = $state('');
  /** Toolbar popover open (spacing, transparency, more, …). */
  pop = $state<string | null>(null);
  pagesStrip = $state(false);
  gridView = $state(false);
  notes = $state(false);

  reset(): void {
    this.panel = 'elements';
    this.lastRail = 'elements';
    this.color = null;
    this.pop = null;
    this.pagesStrip = false;
    this.gridView = false;
    this.notes = false;
  }

  /** Rail click: open that section, or collapse the panel when it is already open (Canva). */
  rail(t: RailTab): void {
    this.panel = this.panel === t ? null : t;
    this.lastRail = t;
  }

  /** Open a contextual panel; the same button again goes back to the rail section. */
  open(p: ToolPanel, toggle = true): void {
    this.pop = null;
    this.panel = toggle && this.panel === p ? this.lastRail : p;
  }

  openColor(t: ColorTarget): void {
    this.color = t;
    this.open('color', false);
  }

  /** Leave a contextual panel (it no longer applies). */
  close(): void {
    if (this.panel && !RAIL_TABS.includes(this.panel as RailTab)) this.panel = this.lastRail;
    this.color = null;
  }

  get isRail(): boolean {
    return !!this.panel && RAIL_TABS.includes(this.panel as RailTab);
  }
}

export const ui = new UI();
