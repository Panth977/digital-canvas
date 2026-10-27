/**
 * Google sign-in inside the native app. Google refuses OAuth in embedded
 * WebViews, so the app opens Google's page in the system browser
 * (SFSafariViewController / Chrome Custom Tab) with the WEB client and the
 * hosted callback as redirect URI. The hosted /auth/callback sees the
 * `dcapp.` state and bounces the code to `com.panth977.digitalcanvas://auth`
 * (see bounce.ts); the app catches that URL here and gives the code to the
 * backend's googleSignIn with the same redirect URI.
 */
import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from '@digital-canvas/backend/google';
import { APP_SCHEME, APP_STATE_PREFIX, HOSTED_CALLBACK } from './platform.ts';

export interface CodeRequest { consent?: boolean; hint?: string; scopes?: string[] }

/** Google's authorization URL for the native flow (pure; tested). */
export function nativeAuthUrl(opts: CodeRequest, state: string): string {
  const q = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: HOSTED_CALLBACK,
    response_type: 'code',
    scope: [...GOOGLE_SCOPES, ...(opts.scopes ?? [])].join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: opts.consent ? 'consent' : 'select_account',
    state,
  });
  if (opts.hint) q.set('login_hint', opts.hint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

/** Parse `com.panth977.digitalcanvas://auth?…` (pure; tested). Null for other URLs. */
export function parseAppAuthUrl(url: string): { state: string; code?: string; error?: string } | null {
  if (!url.startsWith(`${APP_SCHEME}://auth`)) return null;
  const q = new URLSearchParams(url.slice(url.indexOf('?') + 1));
  const state = q.get('state');
  if (!state?.startsWith(APP_STATE_PREFIX)) return null;
  return { state, code: q.get('code') ?? undefined, error: q.get('error') ?? undefined };
}

export class NativeSignInCancelled extends Error {
  override name = 'SignInCancelled';
}

/** Open Google in the system browser and wait for the bounced code. */
export async function nativeRequestCode(opts: CodeRequest = {}): Promise<{ code: string; redirectUri: string }> {
  const [{ App }, { Browser }] = await Promise.all([import('@capacitor/app'), import('@capacitor/browser')]);
  const state = APP_STATE_PREFIX + crypto.randomUUID();
  let settled = false;
  const subs: { remove(): Promise<void> }[] = [];
  const cleanup = () => {
    settled = true;
    for (const s of subs) void s.remove();
  };
  return new Promise((resolve, reject) => {
    void (async () => {
      subs.push(await App.addListener('appUrlOpen', ({ url }) => {
        const r = parseAppAuthUrl(url);
        if (!r || r.state !== state || settled) return;
        cleanup();
        void Browser.close().catch(() => {});
        if (r.code) resolve({ code: r.code, redirectUri: HOSTED_CALLBACK });
        else if (r.error === 'access_denied') reject(new NativeSignInCancelled('Sign-in was cancelled.'));
        else reject(new Error(r.error ? `Google sign-in failed (${r.error}).` : 'Google sign-in failed.'));
      }));
      // The user closed the browser sheet without finishing. The app URL can
      // arrive just after this event on Android, so wait a moment.
      subs.push(await Browser.addListener('browserFinished', () => {
        setTimeout(() => {
          if (settled) return;
          cleanup();
          reject(new NativeSignInCancelled('Sign-in was closed.'));
        }, 1500);
      }));
      await Browser.open({ url: nativeAuthUrl(opts, state), presentationStyle: 'popover' });
    })().catch((e) => {
      cleanup();
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });
}
