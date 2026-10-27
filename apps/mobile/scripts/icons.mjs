// Renders every app icon and splash image from apps/web/public/favicon.svg's design,
// with Playwright's Chromium (already a dev dependency). Run from the repo root:
//   node apps/mobile/scripts/icons.mjs
// Writes: apps/web/public/icons/* (PWA), the iOS AppIcon + Splash, the Android
// mipmaps (legacy, round, adaptive foreground) and splash drawables.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const web = join(root, 'apps/web/public');
const ios = join(root, 'apps/mobile/ios/App/App/Assets.xcassets');
const res = join(root, 'apps/mobile/android/app/src/main/res');

const GRADIENT = '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#00c4cc"/></linearGradient>';
const motif = (f) => `<g transform="translate(32 32) scale(${f}) translate(-33 -33)"><rect x="14" y="14" width="22" height="22" rx="4" fill="#fff" opacity=".95"/><circle cx="40" cy="40" r="12" fill="#fff" opacity=".7"/></g>`;

/** Icon variants on a 64×64 view box. */
const variants = {
  // The favicon itself: rounded square, transparent corners.
  any: readFileSync(join(web, 'favicon.svg'), 'utf8'),
  // Full-bleed square (iOS rounds it; apple-touch-icon; Android legacy square).
  full: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${GRADIENT}</defs><rect width="64" height="64" fill="url(#g)"/>${motif(1)}</svg>`,
  // Maskable: art inside the 80 % safe circle.
  maskable: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${GRADIENT}</defs><rect width="64" height="64" fill="url(#g)"/>${motif(0.8)}</svg>`,
  // Android adaptive foreground (108 dp, 66 dp safe circle): full-bleed so parallax never shows an edge.
  adaptive: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${GRADIENT}</defs><rect width="64" height="64" fill="url(#g)"/>${motif(0.62)}</svg>`,
  // Legacy round launcher icon.
  round: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${GRADIENT}</defs><circle cx="32" cy="32" r="32" fill="url(#g)"/>${motif(0.85)}</svg>`,
};

/** Splash: gradient with the icon in the middle, any aspect ratio. */
function splash(w, h) {
  const s = Math.min(w, h) * 0.22;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${GRADIENT.replace('id="g"', 'id="g" gradientUnits="objectBoundingBox"')}</defs><rect width="${w}" height="${h}" fill="url(#g)"/><svg x="${(w - s) / 2}" y="${(h - s) / 2}" width="${s}" height="${s}" viewBox="0 0 64 64">${motif(1.25)}</svg></svg>`;
}

function pngSize(file) {
  const d = readFileSync(file);
  return [d.readUInt32BE(16), d.readUInt32BE(20)];
}

const browser = await chromium.launch();
const page = await browser.newPage();

async function render(svg, w, h, file, opaque = false) {
  await page.setViewportSize({ width: w, height: h });
  const head = svg.slice(0, svg.indexOf('>'));
  const sized = /\swidth=/.test(head) ? svg : svg.replace('<svg ', `<svg width="${w}" height="${h}" `);
  await page.setContent(`<html><body style="margin:0;background:transparent"><div style="display:flex">${sized}</div></body></html>`);
  await page.screenshot({ path: file, omitBackground: !opaque, clip: { x: 0, y: 0, width: w, height: h } });
  console.log('wrote', file.replace(root + '/', ''), `${w}×${h}`);
}

// PWA (apps/web/public/icons).
await render(variants.any, 192, 192, join(web, 'icons/icon-192.png'));
await render(variants.any, 512, 512, join(web, 'icons/icon-512.png'));
await render(variants.maskable, 512, 512, join(web, 'icons/maskable-512.png'), true);
await render(variants.full, 180, 180, join(web, 'icons/apple-touch-icon.png'), true);

// iOS: one 1024 icon (no alpha) + the splash image set.
await render(variants.full, 1024, 1024, join(ios, 'AppIcon.appiconset/AppIcon-512@2x.png'), true);
for (const f of readdirSync(join(ios, 'Splash.imageset')).filter((n) => n.endsWith('.png'))) {
  await render(splash(2732, 2732), 2732, 2732, join(ios, 'Splash.imageset', f), true);
}

// Android: launcher icons per density, splash drawables at their existing sizes.
for (const dir of readdirSync(res)) {
  const p = join(res, dir);
  if (!statSync(p).isDirectory()) continue;
  for (const name of readdirSync(p)) {
    const file = join(p, name);
    if (!name.endsWith('.png')) continue;
    const [w, h] = pngSize(file);
    if (name === 'ic_launcher.png') await render(variants.full, w, h, file, true);
    else if (name === 'ic_launcher_round.png') await render(variants.round, w, h, file);
    else if (name === 'ic_launcher_foreground.png') await render(variants.adaptive, w, h, file, true);
    else if (name === 'splash.png') await render(splash(w, h), w, h, file, true);
  }
}
writeFileSync(join(res, 'values/ic_launcher_background.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#7D2AE8</color>\n</resources>\n');

await browser.close();
