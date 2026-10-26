import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from '@digital-canvas/backend/google';

/** Google Identity Services, authorization-code flow in a popup. */
interface CodeClient { requestCode(): void }
interface GoogleOAuth2 {
  initCodeClient(cfg: {
    client_id: string;
    scope: string;
    ux_mode: 'popup' | 'redirect';
    redirect_uri?: string;
    state?: string;
    prompt?: '' | 'consent' | 'select_account';
    login_hint?: string;
    include_granted_scopes?: boolean;
    callback: (r: { code?: string; scope?: string; error?: string; error_description?: string }) => void;
    error_callback?: (e: { type: string; message?: string }) => void;
  }): CodeClient;
}
declare global {
  interface Window { google?: { accounts: { oauth2: GoogleOAuth2 } } }
}

let loading: Promise<GoogleOAuth2> | null = null;

function gis(): Promise<GoogleOAuth2> {
  loading ??= new Promise((resolve, reject) => {
    if (window.google?.accounts) return resolve(window.google.accounts.oauth2);
    const s = Object.assign(document.createElement('script'), { src: 'https://accounts.google.com/gsi/client', async: true });
    s.onload = () => resolve(window.google!.accounts.oauth2);
    s.onerror = () => { loading = null; reject(new Error('Could not load Google sign-in.')); };
    document.head.append(s);
  });
  return loading;
}

export class SignInCancelled extends Error {
  override name = 'SignInCancelled';
}

/** Ask Google for an authorization code. `consent` forces a new refresh token. */
export async function requestCode(opts: { consent?: boolean; hint?: string } = {}): Promise<string> {
  const oauth2 = await gis();
  return new Promise((resolve, reject) => {
    const client = oauth2.initCodeClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_SCOPES.join(' '),
      ux_mode: 'popup',
      prompt: opts.consent ? 'consent' : 'select_account',
      login_hint: opts.hint,
      include_granted_scopes: true,
      callback: (r) => (r.code ? resolve(r.code) : reject(new Error(r.error_description ?? r.error ?? 'Google sign-in failed'))),
      error_callback: (e) => reject(e.type === 'popup_closed' ? new SignInCancelled('Sign-in was closed.') : new Error(e.message ?? e.type)),
    });
    client.requestCode();
  });
}

export const CALLBACK_PATH = '/auth/callback';

/** Same as requestCode, but leaves the page: Google sends the browser back to /auth/callback. */
export async function redirectForCode(opts: { consent?: boolean; hint?: string; returnTo?: string } = {}): Promise<never> {
  const oauth2 = await gis();
  const state = crypto.randomUUID();
  sessionStorage.setItem('dc-oauth', JSON.stringify({ state, returnTo: opts.returnTo ?? location.hash }));
  oauth2.initCodeClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPES.join(' '),
    ux_mode: 'redirect',
    redirect_uri: location.origin + CALLBACK_PATH,
    state,
    prompt: opts.consent ? 'consent' : 'select_account',
    login_hint: opts.hint,
    include_granted_scopes: true,
    callback: () => {},
  }).requestCode();
  return new Promise(() => {});
}

/** On /auth/callback: the code Google sent, if its state matches ours. */
export function takeRedirectCode(): { code: string; redirectUri: string; returnTo: string } | { error: string } | null {
  if (location.pathname !== CALLBACK_PATH) return null;
  const q = new URLSearchParams(location.search);
  const saved = JSON.parse(sessionStorage.getItem('dc-oauth') ?? 'null') as { state: string; returnTo: string } | null;
  sessionStorage.removeItem('dc-oauth');
  history.replaceState(null, '', '/' + (saved?.returnTo ?? ''));
  if (q.get('error')) return { error: q.get('error') === 'access_denied' ? '' : q.get('error')! };
  const code = q.get('code');
  if (!code || !saved || saved.state !== q.get('state')) return { error: 'Sign-in could not be verified. Please try again.' };
  return { code, redirectUri: location.origin + CALLBACK_PATH, returnTo: saved.returnTo };
}
