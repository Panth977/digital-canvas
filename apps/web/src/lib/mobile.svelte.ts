/**
 * Phone layout state. Screens narrower than 768 px get Canva's mobile editor
 * (top bar, full-screen canvas, bottom toolbar, bottom sheets); wider ones
 * keep the desktop UI unchanged.
 *
 * Also tracks the visual viewport, which shrinks when the on-screen keyboard
 * opens (iOS does not resize the layout viewport), so the editor can keep
 * its toolbar and the text being edited above the keyboard.
 */
export const MOBILE_QUERY = '(max-width: 767px)';

/** Bottom-sheet contents on the phone that are not side panels: small tool sheets. */
export type MobileSheet = 'size' | 'spacing' | 'opacity' | 'format' | 'pages' | 'menu' | 'download' | 'resize';

class Mobile {
  /** The phone layout is on. */
  on = $state(false);
  /** Visible height and top of the visual viewport (CSS px). */
  vh = $state(0);
  top = $state(0);
  /** The on-screen keyboard is (probably) open: the visual viewport is much shorter than the window. */
  keyboard = $state(false);
  /** A small tool sheet open on the phone (side panels use `ui.panel`). */
  sheet = $state<MobileSheet | null>(null);
  /** Bottom sheet height: half or full screen. */
  sheetSize = $state<'half' | 'full'>('half');

  constructor() {
    if (typeof window === 'undefined') return;
    const mq = matchMedia(MOBILE_QUERY);
    this.on = mq.matches;
    mq.addEventListener('change', () => (this.on = mq.matches));
    const vv = window.visualViewport;
    const read = () => {
      this.vh = vv ? vv.height : innerHeight;
      this.top = vv ? vv.offsetTop : 0;
      this.keyboard = !!vv && innerHeight - vv.height > 120;
    };
    read();
    vv?.addEventListener('resize', read);
    vv?.addEventListener('scroll', read);
    addEventListener('resize', read);
  }
}

export const mobile = new Mobile();

/** The last pointer was a finger (touch UI: bigger handles, gestures). */
export const isTouch = (e: PointerEvent | MouseEvent): boolean => (e as PointerEvent).pointerType === 'touch';
