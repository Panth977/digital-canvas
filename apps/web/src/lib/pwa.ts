/**
 * Progressive Web App: the service worker (built from pwa-sw.js by the
 * plugin in vite.config.ts) is registered only in production builds in a
 * browser — never in `vite dev` (e2e runs there) and never inside the
 * Capacitor shell, which already has its files on the device.
 */
import { isNative } from './native/platform.ts';

/** Stand-in Drive token while offline: the service worker answers from its cache, Google never sees it. */
export const OFFLINE_TOKEN = 'offline';

/** Cache that keeps recent Drive reads (keep in step with pwa-sw.js). */
const DRIVE_CACHE = 'dc-drive-v1';

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || isNative() || !('serviceWorker' in navigator)) return;
  const go = () => navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('Service worker not registered', e));
  if (document.readyState === 'complete') void go();
  else addEventListener('load', () => void go(), { once: true });
}

/** Forget the Drive files kept for offline use (sign-out). */
export async function clearOfflineDrive(): Promise<void> {
  if (typeof caches === 'undefined') return;
  await caches.delete(DRIVE_CACHE).catch(() => false);
}
