import { onAuthStateChanged, signInWithCustomToken, signOut } from '@panth977/icebase/auth';
import { auth, driveToken, googleSignIn } from './icebase.ts';
import { getCode, redirectForCode, takeRedirectCode } from './google.ts';
import { isNative } from './native/platform.ts';
import { OFFLINE_TOKEN, clearOfflineDrive } from './pwa.ts';

export interface Account {
  uid: string;
  email: string;
  name: string;
  photo?: string;
}

/**
 * The signed-in account. Signing in is one Google popup: it proves who you
 * are and lets the backend keep your Drive connection, so other devices
 * only need to sign in.
 */
class AccountState {
  user = $state<Account | null>(null);
  /** False until Firebase has restored (or not) the last session. */
  known = $state(false);
  busy = $state(false);
  error = $state('');
  private token: { value: string; expires: number } | null = null;

  constructor() {
    onAuthStateChanged(auth, (u) => {
      this.user = u ? { uid: u.uid, email: u.email ?? '', name: u.displayName ?? u.email ?? 'You', photo: u.photoURL ?? undefined } : null;
      if (!u) {
        this.token = null;
      }
      this.known = true;
    });
  }

  /** Finish a redirect sign-in when Google sends the browser back. Call once at start-up. */
  async finishRedirect(): Promise<void> {
    const r = takeRedirectCode();
    if (!r) return;
    if ('error' in r) {
      this.error = r.error;
      return;
    }
    this.busy = true;
    try {
      const res = await googleSignIn({ code: r.code, redirectUri: r.redirectUri });
      if (!res.driveConnected) return void (await redirectForCode({ consent: true, returnTo: r.returnTo }));
      if (res.accessToken) this.keep(res.accessToken, res.expiresIn);
      await signInWithCustomToken(auth, res.token);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.busy = false;
    }
  }

  /** Sign in by leaving the page (no popup: phones, popup blockers). */
  signInRedirect(): Promise<never> {
    this.busy = true;
    return redirectForCode();
  }

  async signIn(): Promise<boolean> {
    this.busy = true;
    this.error = '';
    try {
      let r = await googleSignIn(await getCode());
      if (!r.driveConnected) {
        // Google only hands out a refresh token with explicit consent.
        r = await googleSignIn(await getCode({ consent: true }));
      }
      if (r.accessToken) this.keep(r.accessToken, r.expiresIn);
      await signInWithCustomToken(auth, r.token);
      return true;
    } catch (e) {
      if ((e as Error).name === 'SignInCancelled') return false;
      // Popup blocked or failed to open: fall back to a full-page redirect.
      if (!isNative() && /popup/i.test(String((e as Error).message))) await this.signInRedirect();
      this.error = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      this.busy = false;
    }
  }

  private keep(value: string, expiresIn = 3600): void {
    this.token = { value, expires: Date.now() + expiresIn * 1000 };
  }

  async signOut(): Promise<void> {
    this.token = null;
    // Designs the service worker kept for offline use belong to this account.
    await clearOfflineDrive();
    await signOut(auth);
  }

  /** A Drive access token, refreshed through the backend a minute before it expires. */
  readonly driveToken = async (force = false): Promise<string> => {
    if (!force && this.token && this.token.expires - 60_000 > Date.now()) return this.token.value;
    try {
      const r = await driveToken({});
      this.keep(r.accessToken, r.expiresIn);
      return r.accessToken;
    } catch (e) {
      // Offline: no token, but the service worker answers Drive reads it has
      // seen before (recent designs open offline). See lib/pwa-sw.js.
      if (!force && typeof navigator !== 'undefined' && navigator.onLine === false) return OFFLINE_TOKEN;
      if (/drive-not-connected|failed-precondition/.test(String((e as { code?: string }).code ?? '') + String((e as Error).message))) {
        // The stored connection was revoked: one consent popup fixes it.
        const r = await googleSignIn(await getCode({ consent: true, hint: this.user?.email }));
        if (!r.accessToken) throw e;
        this.keep(r.accessToken, r.expiresIn);
        return r.accessToken;
      }
      throw e;
    }
  };
}

export const account = new AccountState();
void account.finishRedirect();
if (import.meta.env.DEV) (window as unknown as { __account?: AccountState }).__account = account;
