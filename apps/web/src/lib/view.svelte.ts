/**
 * Editor view options (not part of the design): rulers and guides, print
 * bleed, safe margins, snapping. Remembered in this browser.
 */
const KEY = 'dc:view';

interface Prefs { rulers: boolean; bleed: boolean; margins: boolean; snap: boolean }

class View {
  rulers = $state(false);
  bleed = $state(false);
  margins = $state(false);
  snap = $state(true);

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
}

export const view = new View();
