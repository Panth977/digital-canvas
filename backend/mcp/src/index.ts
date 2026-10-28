// Digital Canvas remote MCP server (its own functions codebase "mcp"; IceBase's
// googleSignIn/driveToken live in the default codebase and are untouched).
//
// mcp:       https://digital-canvas-p977.web.app/mcp (+ /.well-known/*, /oauth/*) via Hosting rewrites.
//            OAuth 2.1 (DCR + PKCE) with Google as identity; MCP Streamable HTTP, stateless.
// mcpExport: Cloud Tasks worker for long video exports (status in users/{uid}/mcpJobs).
//
// Processing: tools run on the user's own device (the web app / Android app relays them through
// Firestore: see packages/mcp/src/bridge) unless the user is on the cloud allowlist
// (DC_CLOUD_ALLOWLIST, default ppanth977@gmail.com) and chose cloud. Then they run here as before.
//
// ffmpeg comes from ffmpeg-static (GPL), a dependency of the deployed function only:
// it runs on our server and is not distributed with @digital-canvas/mcp.
import { createRequire } from 'node:module';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { createRemoteHandler } from '../../../packages/mcp/src/remote/http.ts';
import { decrypt } from '../../../packages/mcp/src/remote/oauth.ts';
import { runJob } from '../../../packages/mcp/src/server.ts';
import { DriveWorkspace } from '../../../packages/mcp/src/workspace.ts';
import { GOOGLE_CLIENT_ID } from '../../google.ts';
import { FirestoreOAuthStore } from './store.ts';
import { FirestoreBridgeStore } from './bridge.ts';
import { parseAllowlist } from '../../../packages/mcp/src/bridge/routing.ts';
import { REGION, TaskQueueJobs, jobDoc, type ExportTask } from './jobs.ts';

try {
  const p = createRequire(import.meta.url)('ffmpeg-static') as string | null;
  if (p && !process.env.DC_FFMPEG) process.env.DC_FFMPEG = p;
} catch { /* video export reports that ffmpeg is missing */ }

initializeApp();
const db = getFirestore();
const store = new FirestoreOAuthStore(db);
const SECRETS = ['GOOGLE_CLIENT_SECRET', 'TOKEN_KEY'];
const PUBLIC_BASE = process.env.DC_PUBLIC_BASE ?? 'https://digital-canvas-p977.web.app';

let handler: ReturnType<typeof createRemoteHandler> | null = null;
const getHandler = () => (handler ??= createRemoteHandler({
  publicBase: PUBLIC_BASE,
  store,
  google: { clientId: GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '', tokenKey: process.env.TOKEN_KEY ?? '' },
  jobs: (uid) => new TaskQueueJobs(db, uid),
  editorUrl: PUBLIC_BASE,
  bridge: { store: new FirestoreBridgeStore(db), allowlist: parseAllowlist(process.env.DC_CLOUD_ALLOWLIST) },
}));

export const mcp = onRequest(
  // concurrency 16: in device mode a request mostly waits on the user's device (I/O); cloud rendering is allowlisted users only.
  { region: REGION, memory: '2GiB', cpu: 1, timeoutSeconds: 540, minInstances: 0, maxInstances: 10, concurrency: 16, secrets: SECRETS, invoker: 'public' },
  (req, res) => getHandler()(req, res),
);

/** A Drive access token for `uid` from the stored refresh token. */
async function driveAccess(uid: string): Promise<{ token: string; scope: string }> {
  const d = (await db.collection('users').doc(uid).collection('private').doc('drive').get()).data() as { refreshToken?: string; scope?: string } | undefined;
  if (!d?.refreshToken) throw new Error('Google Drive is not connected');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '', refresh_token: decrypt(d.refreshToken, process.env.TOKEN_KEY ?? ''), grant_type: 'refresh_token' }),
  });
  const t = (await r.json()) as { access_token?: string; scope?: string; error?: string };
  if (!t.access_token) throw new Error(`Google token refresh failed: ${t.error ?? r.status}`);
  return { token: t.access_token, scope: t.scope ?? d.scope ?? '' };
}

export const mcpExport = onTaskDispatched<ExportTask>(
  { region: REGION, memory: '4GiB', cpu: 2, timeoutSeconds: 1800, retryConfig: { maxAttempts: 1 }, rateLimits: { maxConcurrentDispatches: 4 }, secrets: SECRETS },
  async (req) => {
    const { uid, jobId, spec } = req.data;
    const ref = jobDoc(db, uid, jobId);
    await ref.set({ state: 'running', startedAt: FieldValue.serverTimestamp() }, { merge: true });
    try {
      let tok = await driveAccess(uid);
      const ws = new DriveWorkspace(async (force) => { if (force) tok = await driveAccess(uid); return tok.token; }, tok.scope);
      let last = 0;
      const result = await runJob(ws, spec, (p: number) => {
        if (p - last >= 0.1) { last = p; void ref.set({ progress: Math.round(p * 100) / 100 }, { merge: true }); }
      });
      await ref.set({ state: 'done', progress: 1, result, finishedAt: FieldValue.serverTimestamp() }, { merge: true });
    } catch (e) {
      await ref.set({ state: 'failed', error: e instanceof Error ? e.message : String(e), finishedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  },
);

