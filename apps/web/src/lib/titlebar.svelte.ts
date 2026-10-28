/**
 * The installed app's window. With Window Controls Overlay (manifest
 * `display_override: ["window-controls-overlay"]`, Chrome/Edge on macOS,
 * Windows, Linux) the page draws the title bar itself: the CSS env()
 * variables `titlebar-area-x/y/width/height` give the free strip next to the
 * traffic lights / caption buttons, and the design tabs go there (Canva).
 *
 * WCO is read from those env() values (as `--tb-x/y/w/h`, app.css) through a
 * hidden probe element, so it also follows the user toggling the title bar
 * (the chevron). e2e stands in for the window by setting those properties.
 */
const STANDALONE = '(display-mode: standalone), (display-mode: window-controls-overlay), (display-mode: minimal-ui), (display-mode: fullscreen)';

class TitleBar {
  /** The page draws the title bar (WCO on). */
  wco = $state(false);
  /** Running as an installed app (any of the app display modes). */
  standalone = $state(false);
  /** The free title-bar area (CSS px), when `wco`. */
  area = $state({ x: 0, y: 0, width: 0, height: 0 });

  constructor() {
    if (typeof window === 'undefined') return;
    const mq = matchMedia(STANDALONE);
    this.standalone = mq.matches;
    mq.addEventListener('change', () => {
      this.standalone = mq.matches;
      this.read();
    });
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;top:var(--tb-y);left:var(--tb-x);width:var(--tb-w);height:var(--tb-h)';
    this.probe = probe;
    const attach = () => {
      document.body.appendChild(probe);
      new ResizeObserver(() => this.read()).observe(probe);
      this.read();
    };
    if (document.body) attach();
    else addEventListener('DOMContentLoaded', attach, { once: true });
    const wco = (navigator as Navigator & { windowControlsOverlay?: EventTarget }).windowControlsOverlay;
    wco?.addEventListener('geometrychange', () => this.read());
    addEventListener('resize', () => this.read());
  }

  private probe: HTMLElement | null = null;

  private read(): void {
    const r = this.probe?.getBoundingClientRect();
    if (!r) return;
    this.area = { x: r.left, y: r.top, width: r.width, height: r.height };
    this.wco = r.height > 0 && r.width > 0;
  }
}

export const titlebar = new TitleBar();
