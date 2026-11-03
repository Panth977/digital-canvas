/**
 * Progressive Web App: the service worker (built from pwa-sw.js by the
 * plugin in vite.config.ts) is registered only in production builds in a
 * browser — never in `vite dev` (e2e runs there) and never inside the
 * Capacitor shell, which already has its files on the device.
 */
import { isNative } from './native/platform.ts';
import { isDesktop } from './desktop/desktop.svelte.ts';

/** Stand-in Drive token while offline: the service worker answers from its cache, Google never sees it. */
export const OFFLINE_TOKEN = 'offline';

/** Cache that keeps recent Drive reads (keep in step with pwa-sw.js). */
const DRIVE_CACHE = 'dc-drive-v1';

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  // The desktop app serves the files itself: a service worker only gets in the way
  // (it failed the window's next start), so drop one an older version left behind.
  if (isDesktop()) { void navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => void r.unregister())).catch(() => {}); return; }
  if (!import.meta.env.PROD || isNative()) return;
  const go = () => navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('Service worker not registered', e));
  if (document.readyState === 'complete') void go();
  else addEventListener('load', () => void go(), { once: true });
}

/** Forget the Drive files kept for offline use (sign-out). */
export async function clearOfflineDrive(): Promise<void> {
  if (typeof caches === 'undefined') return;
  await caches.delete(DRIVE_CACHE).catch(() => false);
}
