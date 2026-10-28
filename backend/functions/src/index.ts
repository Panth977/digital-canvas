// Digital Canvas backend. Two functions; designs never pass through here.
//
// googleSignIn: exchanges the Google authorization code from the browser (GIS code
//   flow, redirect_uri "postmessage"), signs the user in with a custom token and
//   keeps the Drive refresh token, encrypted, so every other device works without
//   connecting Drive again.
// driveToken: a fresh Drive access token for the signed-in user, with the scopes it carries.
// aiSettings: where the AI connector runs tools for you (your device or, for allowlisted accounts,
//   our cloud) and which device; the MCP relay (backend/mcp) reads the same users/{uid} fields.
//
// Drive access is drive.file only: the app sees its own folder plus the files the user
// picks with Google Picker (Uploads → Google Drive), which uses this same access token.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { HttpsError, onCall } from '@panth977/icebase-server/functions';
import { getAdminAuth, getAdminFirestore, initializeAdminApp } from '@panth977/icebase-server/admin';
import { collection, deleteDoc, deleteField, doc, getDoc, increment, serverTimestamp, setDoc } from '@panth977/icebase/firestore';
import { effectiveMode, parseAllowlist } from '../../../packages/mcp/src/bridge/routing.ts';
import { drive, users } from '../../icebase/schema.ts';
import config from '../../icebase.config.ts';
import { api } from '../../icebase/api.ts';
import { GOOGLE_CLIENT_ID, REGION } from '../../google.ts';

const app = initializeAdminApp(config, (process.env.ICEBASE_ENV ?? 'prod') as 'local' | 'prod');
const db = getAdminFirestore(app);
const auth = getAdminAuth(app);

const SECRETS = ['GOOGLE_CLIENT_SECRET', 'TOKEN_KEY'];
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const ORIGINS = ['http://localhost:5181', 'https://digital-canvas-p977.web.app', 'https://digital-canvas-p977.firebaseapp.com'];

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

async function googleToken(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '', ...params }),
  });
  return (await res.json()) as TokenResponse;
}

/** The ID token comes straight from Google's token endpoint over TLS, so its claims can be read without re-verifying the signature. */
function idClaims(idToken: string): { sub: string; email: string; email_verified?: boolean; name?: string; picture?: string; aud: string } {
  const payload = idToken.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

function key(): Buffer {
  const k = Buffer.from(process.env.TOKEN_KEY ?? '', 'base64');
  if (k.length !== 32) throw new HttpsError('internal', 'TOKEN_KEY is not set');
  return k;
}

function encrypt(text: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}

function decrypt(blob: string): string {
  const [iv, tag, body] = blob.split('.').map((s) => Buffer.from(s, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', key(), iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(body!), d.final()]).toString('utf8');
}

const driveDoc = (uid: string) => doc(collection(db, drive, uid), 'drive');

export const googleSignIn = onCall(api.googleSignIn, { secrets: SECRETS, cors: ORIGINS, region: REGION }, async (req) => {
  // Popup flow uses "postmessage"; the redirect flow uses <origin>/auth/callback on one of our origins.
  const redirectUri = req.data.redirectUri ?? 'postmessage';
  if (redirectUri !== 'postmessage' && !ORIGINS.some((o) => redirectUri === `${o}/auth/callback`)) throw new HttpsError('invalid-argument', 'Unknown redirect URI');
  const t = await googleToken({ code: req.data.code, grant_type: 'authorization_code', redirect_uri: redirectUri });
  if (!t.id_token || !t.access_token) throw new HttpsError('invalid-argument', t.error_description ?? t.error ?? 'Google rejected the code');
  const claims = idClaims(t.id_token);
  if (claims.aud !== GOOGLE_CLIENT_ID || !claims.email) throw new HttpsError('invalid-argument', 'ID token is not for this app');
  const hasDrive = (t.scope ?? '').split(' ').includes(DRIVE_SCOPE);
  if (!hasDrive) throw new HttpsError('permission-denied', 'Digital Canvas needs access to the files it creates in your Drive.');

  const uid = `google:${claims.sub}`;
  await auth.getUser(uid).catch(() => auth.createUser({ uid, email: claims.email, displayName: claims.name, photoURL: claims.picture, emailVerified: !!claims.email_verified }));

  const userRef = doc(collection(db, users), uid);
  const existing = await getDoc(userRef);
  await setDoc(userRef, {
    email: claims.email,
    name: claims.name ?? claims.email,
    ...(claims.picture ? { photo: claims.picture } : {}),
    loginCount: increment(1),
    lastLogin: serverTimestamp(),
    ...(existing.exists() ? {} : { createdAt: serverTimestamp() }),
  } as never, { merge: true });

  // Google returns a refresh token only on first consent (or prompt=consent). Keep the one we have otherwise.
  let driveConnected = false;
  if (t.refresh_token) {
    await setDoc(driveDoc(uid), { refreshToken: encrypt(t.refresh_token), scope: t.scope ?? '', updatedAt: serverTimestamp() } as never);
    driveConnected = true;
  } else {
    driveConnected = (await getDoc(driveDoc(uid))).exists();
  }

  const token = await auth.createCustomToken(uid);
  return { token, driveConnected, accessToken: t.access_token, expiresIn: t.expires_in ?? 3600, scope: t.scope ?? '' };
});

export const driveToken = onCall(api.driveToken, { secrets: SECRETS, cors: ORIGINS, region: REGION }, async (req) => {
  const uid = req.auth!.uid;
  const snap = await getDoc(driveDoc(uid));
  const stored = snap.data() as { refreshToken?: string; scope?: string } | undefined;
  if (!stored?.refreshToken) throw new HttpsError('failed-precondition', 'drive-not-connected');
  const t = await googleToken({ refresh_token: decrypt(stored.refreshToken), grant_type: 'refresh_token' });
  if (t.error === 'invalid_grant') {
    // Revoked or expired: forget it so the next sign-in asks for consent again.
    await deleteDoc(driveDoc(uid));
    throw new HttpsError('failed-precondition', 'drive-not-connected');
  }
  if (!t.access_token) throw new HttpsError('unavailable', t.error_description ?? t.error ?? 'Google token refresh failed');
  return { accessToken: t.access_token, expiresIn: t.expires_in ?? 3600, scope: t.scope ?? stored.scope ?? '' };
});

// Cloud processing is for these accounts only (env DC_CLOUD_ALLOWLIST, comma-separated; same in backend/mcp).
const CLOUD_ALLOWLIST = parseAllowlist(process.env.DC_CLOUD_ALLOWLIST);

export const aiSettings = onCall(api.aiSettings, { cors: ORIGINS, region: REGION }, async (req) => {
  const uid = req.auth!.uid;
  const ref = doc(collection(db, users), uid);
  const data = (await getDoc(ref)).data() as { email?: string; processing?: 'device' | 'cloud'; activeDevice?: string } | undefined;
  const email = data?.email ?? (req.auth!.token as { email?: string }).email ?? '';
  const before = effectiveMode({ email, ...(data?.processing ? { processing: data.processing } : {}) }, CLOUD_ALLOWLIST);
  const patch: Record<string, unknown> = {};
  if (req.data.processing) {
    if (req.data.processing === 'cloud' && !before.cloudAllowed) throw new HttpsError('permission-denied', 'Cloud processing is not available for this account');
    patch.processing = req.data.processing;
  }
  if (req.data.activeDevice !== undefined) patch.activeDevice = req.data.activeDevice ? req.data.activeDevice : deleteField();
  if (Object.keys(patch).length) await setDoc(ref, patch as never, { merge: true });
  const processing = (patch.processing as 'device' | 'cloud' | undefined) ?? data?.processing;
  const m = effectiveMode({ email, ...(processing ? { processing } : {}) }, CLOUD_ALLOWLIST);
  const active = req.data.activeDevice !== undefined ? req.data.activeDevice : data?.activeDevice;
  return { mode: m.mode, requested: m.requested, cloudAllowed: m.cloudAllowed, ...(active ? { activeDevice: active } : {}) };
});
