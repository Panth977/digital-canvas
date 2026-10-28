/**
 * Editor chrome state (not part of the design): which left-hand panel is
 * open, the colour being picked, popovers. Canva keeps one side panel: the
 * rail sections (Elements, Text, …) and the contextual panels opened from
 * the toolbar (Font, Effects, Position, Colour, …) take turns in it.
 */

export type RailTab = 'ai' | 'templates' | 'elements' | 'text' | 'brand' | 'uploads' | 'draw' | 'projects' | 'apps' | 'photos' | 'videos' | 'sounds';
export type ToolPanel = 'font' | 'color' | 'effects' | 'animate' | 'position' | 'image' | 'table' | 'chart' | 'qr' | 'frame' | 'audio';
export type Panel = RailTab | ToolPanel;

export const RAIL_TABS: readonly RailTab[] = ['ai', 'templates', 'elements', 'text', 'brand', 'uploads', 'draw', 'projects', 'apps', 'photos', 'videos', 'sounds'];

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

import { mobile } from './mobile.svelte.ts';

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
  /** Video timeline: expanded (filmstrip, sounds) or collapsed to its play bar, and its zoom (1 = whole video fits). */
  timelineOpen = $state(true);
  timelineZoom = $state(1);
  /** "Copy style" is armed: the next element selected gets this look. */
  styleClip = $state.raw<{ style: import('./copystyle.ts').CopiedStyle; source: string } | null>(null);

  reset(): void {
    this.panel = mobile.on ? null : 'elements';
    this.lastRail = 'elements';
    mobile.sheet = null;
    this.color = null;
    this.pop = null;
    this.pagesStrip = false;
    this.gridView = false;
    this.notes = false;
    this.styleClip = null;
  }

  /** The chrome a design tab gets back when it is shown again (lib/tabs.svelte.ts). */
  snapshot(): import('./tabs.svelte.ts').UISnap {
    return { panel: this.panel, color: this.color, lastRail: this.lastRail, positionTab: this.positionTab, pagesStrip: this.pagesStrip, gridView: this.gridView, notes: this.notes };
  }

  restore(s: import('./tabs.svelte.ts').UISnap): void {
    this.reset();
    // the tab's selection is kept too, so a contextual panel (font, colour…) still applies
    this.panel = mobile.on ? null : s.panel === 'color' && !s.color ? s.lastRail : s.panel;
    this.color = s.color;
    this.lastRail = s.lastRail;
    this.positionTab = s.positionTab;
    this.pagesStrip = s.pagesStrip;
    this.gridView = s.gridView;
    this.notes = s.notes;
  }

  /** Rail click: open that section, or collapse the panel when it is already open (Canva). */
  rail(t: RailTab): void {
    this.panel = this.panel === t ? null : t;
    this.lastRail = t;
    mobile.sheet = null;
  }

  /** Open a contextual panel; the same button again goes back to the rail section. */
  open(p: ToolPanel, toggle = true): void {
    this.pop = null;
    // the phone shows one sheet at a time: leaving a tool panel closes the sheet
    this.panel = toggle && this.panel === p ? (mobile.on ? null : this.lastRail) : p;
    mobile.sheet = null;
  }

  openColor(t: ColorTarget): void {
    this.color = t;
    this.open('color', false);
  }

  /** Leave a contextual panel (it no longer applies). */
  close(): void {
    if (this.panel && !RAIL_TABS.includes(this.panel as RailTab)) this.panel = mobile.on ? null : this.lastRail;
    this.color = null;
  }

  get isRail(): boolean {
    return !!this.panel && RAIL_TABS.includes(this.panel as RailTab);
  }
}

export const ui = new UI();
