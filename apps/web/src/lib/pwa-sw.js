/* Digital Canvas service worker. Source of /sw.js: the dc-service-worker plugin in
 * vite.config.ts prepends `const VERSION = …, PRECACHE = […]` (every built file) at
 * build time. Plain JS on purpose: it is copied, not bundled.
 *
 *  - App shell (index.html, hashed JS/CSS, CanvasKit wasm, fonts, icons): precached
 *    per build, served cache-first; a new build gets a new cache.
 *  - Page loads: network first, the cached index.html when offline.
 *  - /templates/*.png and Fontsource fonts: stale-while-revalidate.
 *  - Google Drive reads (file lists, file bodies, thumbnails): network first, kept in
 *    a small cache so recently opened designs open offline. Only GETs; the token
 *    is never stored (the cache key is the URL).
 *  - Everything else (Cloud Functions, sign-in, POST/PATCH, uploads): not touched.
 */
/* global VERSION, PRECACHE */

const SHELL = `dc-shell-${VERSION}`;
const RUNTIME = 'dc-runtime-v1';
const DRIVE = 'dc-drive-v1'; // keep in step with lib/pwa.ts
const DRIVE_MAX = 120;
const RUNTIME_MAX = 200;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // One by one so a single missing file can't fail the whole install.
    await Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch((e) => console.warn('precache', url, e))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('dc-shell-') && key !== SHELL) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'clear-drive') event.waitUntil(caches.delete(DRIVE));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') return event.respondWith(page(req));
    if (url.pathname.startsWith('/templates/')) return event.respondWith(staleWhileRevalidate(req, RUNTIME));
    if (url.pathname === '/sw.js') return;
    return event.respondWith(shellFirst(req));
  }
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/fontsource/')) return event.respondWith(staleWhileRevalidate(req, RUNTIME));
  if (url.hostname === 'api.fontsource.org') return event.respondWith(staleWhileRevalidate(req, RUNTIME));
  if (isDriveRead(url)) return event.respondWith(networkFirst(req, DRIVE));
});

/** Drive v3 file lists, metadata and `alt=media` bodies (not uploads, not changes). */
function isDriveRead(url) {
  if (url.hostname === 'www.googleapis.com') return url.pathname.startsWith('/drive/v3/files');
  // Drive thumbnails (thumbnailLink).
  return (url.hostname.endsWith('.googleusercontent.com') && /^\/(drive-storage|d)\//.test(url.pathname)) || (url.hostname === 'drive.google.com' && url.pathname === '/thumbnail');
}

async function page(req) {
  try {
    const res = await fetch(req);
    if (res.ok && new URL(req.url).pathname === '/') (await caches.open(SHELL)).put('/index.html', res.clone());
    return res;
  } catch (e) {
    const cache = await caches.open(SHELL);
    return (await cache.match(req, { ignoreSearch: true, ignoreVary: true })) ?? (await cache.match('/index.html', { ignoreVary: true })) ?? Response.error();
  }
}

async function shellFirst(req) {
  // ignoreVary: the precache request had no Origin header, a module script's does.
  const hit = await caches.match(req, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  // Hashed build files that were not precached (e.g. chunks of an older build).
  if (res.ok && new URL(req.url).pathname.startsWith('/assets/')) (await caches.open(SHELL)).put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req, { ignoreVary: true });
  const fresh = fetch(req).then(async (res) => {
    if (res.ok || res.type === 'opaque') {
      await cache.put(req, res.clone());
      await trim(cache, RUNTIME_MAX);
    }
    return res;
  });
  if (hit) {
    fresh.catch(() => {});
    return hit;
  }
  return fresh;
}

async function networkFirst(req, name) {
  const cache = await caches.open(name);
  try {
    const res = await fetch(req);
    if (res.ok) {
      // The cache key is the URL alone: the Authorization header is not stored.
      await cache.put(new Request(req.url), res.clone());
      await trim(cache, DRIVE_MAX);
    }
    return res;
  } catch (e) {
    const hit = await cache.match(new Request(req.url), { ignoreVary: true });
    if (hit) return hit;
    throw e;
  }
}

/** Keep a cache under `max` entries, oldest first. */
async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}
