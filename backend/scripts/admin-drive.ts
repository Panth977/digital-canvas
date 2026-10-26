/**
 * Admin tool: act on a user's Digital Canvas Drive folder with the Drive connection
 * the backend keeps for them (for support and migrations; the user must have asked).
 *
 *   npx tsx backend/scripts/admin-drive.ts <uid> list
 *   npx tsx backend/scripts/admin-drive.ts <uid> upload <file.dcanvas>
 *   npx tsx backend/scripts/admin-drive.ts <uid> trash <docId>
 *
 * Needs gcloud (logged in to digital-canvas-p977) for Firestore + Secret Manager, and
 * GOOGLE_CLIENT_SECRET in .env.local. Never prints tokens.
 */
import { execFileSync } from 'node:child_process';
import { createDecipheriv } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DriveStore, unpack } from '@digital-canvas/storage';
import { FontLibrary, Renderer } from '@digital-canvas/render';
import { GOOGLE_CLIENT_ID } from '../google.ts';

const PROJECT = 'digital-canvas-p977';
const [uid, cmd, arg] = process.argv.slice(2);
if (!uid || !cmd) {
  console.error('usage: admin-drive.ts <uid> list | upload <file.dcanvas> | trash <docId>');
  process.exit(1);
}
const gcloud = (...a: string[]) => execFileSync('gcloud', a, { encoding: 'utf8' }).trim();
const env = Object.fromEntries(readFileSync(new URL('../../.env.local', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

async function accessToken(): Promise<string> {
  const gt = gcloud('auth', 'print-access-token');
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/users/${encodeURIComponent(uid!)}/private/drive`;
  const doc = (await (await fetch(url, { headers: { Authorization: `Bearer ${gt}` } })).json()) as { fields?: { refreshToken?: { stringValue: string } } };
  const blob = doc.fields?.refreshToken?.stringValue;
  if (!blob) throw new Error(`no Drive connection stored for ${uid}`);
  const key = Buffer.from(gcloud('secrets', 'versions', 'access', 'latest', '--secret', 'TOKEN_KEY', '--project', PROJECT), 'base64');
  const [iv, tag, body] = blob.split('.').map((s) => Buffer.from(s, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', key, iv!);
  d.setAuthTag(tag!);
  const refresh = Buffer.concat([d.update(body!), d.final()]).toString('utf8');
  const r = (await (await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET ?? '', refresh_token: refresh, grant_type: 'refresh_token' }),
  })).json()) as { access_token?: string; error?: string };
  if (!r.access_token) throw new Error(`token refresh failed: ${r.error}`);
  return r.access_token;
}

let token: Promise<string> | null = null;
const store = new DriveStore(() => (token ??= accessToken()));

if (cmd === 'list') {
  for (const m of await store.list()) console.log(`${m.id}\t${m.title}\t${Math.round(m.width)}×${Math.round(m.height)}\t${m.updatedAt}`);
} else if (cmd === 'upload' && arg) {
  const file = unpack(new Uint8Array(readFileSync(arg)));
  if (!file.thumbnail) {
    // Give Drive and the app a preview of page 1.
    const require = createRequire(import.meta.url);
    const ck = await require('canvaskit-wasm/bin/full/canvaskit.js')();
    const fonts = new FontLibrary(ck);
    await fonts.loadBundled(new URL('../../apps/web/public/fonts/', import.meta.url).href, async (u) => readFileSync(new URL(u)).buffer as ArrayBuffer);
    const r = new Renderer(ck, fonts);
    for (const [id, b] of file.assets) r.setImage(id, b);
    file.thumbnail = r.exportPage(file.doc, file.doc.pages[0]!, { scale: Math.min(1, 480 / Math.max(file.doc.width, file.doc.height)) });
  }
  await store.save(file);
  console.log(`uploaded "${file.doc.title}" (${file.doc.pages.length} pages) as ${file.doc.id}`);
} else if (cmd === 'trash' && arg) {
  await store.remove(arg);
  console.log(`moved ${arg} to Drive's bin`);
} else {
  console.error('unknown command');
  process.exit(1);
}
