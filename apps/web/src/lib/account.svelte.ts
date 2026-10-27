import { onAuthStateChanged, signInWithCustomToken, signOut } from '@panth977/icebase/auth';
import { auth, driveToken, googleSignIn } from './icebase.ts';
import { redirectForCode, requestCode, takeRedirectCode } from './google.ts';
import { DRIVE_READONLY_SCOPE } from '@digital-canvas/backend/google';
import { tokenScopes } from '@digital-canvas/storage';

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
  /** Scopes Google granted this app (null until known). */
  scopes = $state<string[] | null>(null);
  private token: { value: string; expires: number } | null = null;

  constructor() {
    onAuthStateChanged(auth, (u) => {
      this.user = u ? { uid: u.uid, email: u.email ?? '', name: u.displayName ?? u.email ?? 'You', photo: u.photoURL ?? undefined } : null;
      if (!u) {
        this.token = null;
        this.scopes = null;
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
      if (res.accessToken) this.keep(res.accessToken, res.expiresIn, res.scope);
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
      let r = await googleSignIn({ code: await requestCode() });
      if (!r.driveConnected) {
        // Google only hands out a refresh token with explicit consent.
        r = await googleSignIn({ code: await requestCode({ consent: true }) });
      }
      if (r.accessToken) this.keep(r.accessToken, r.expiresIn, r.scope);
      await signInWithCustomToken(auth, r.token);
      return true;
    } catch (e) {
      if ((e as Error).name === 'SignInCancelled') return false;
      // Popup blocked or failed to open: fall back to a full-page redirect.
      if (/popup/i.test(String((e as Error).message))) await this.signInRedirect();
      this.error = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      this.busy = false;
    }
  }

  private keep(value: string, expiresIn = 3600, scope?: string): void {
    this.token = { value, expires: Date.now() + expiresIn * 1000 };
    if (scope) this.scopes = scope.split(' ').filter(Boolean);
  }

  /** True once the user let the app read their whole Drive (Uploads → Google Drive). */
  get wholeDrive(): boolean {
    return !!this.scopes?.includes(DRIVE_READONLY_SCOPE) || !!this.scopes?.includes('https://www.googleapis.com/auth/drive');
  }

  /** Find out which scopes we hold (asks Google's tokeninfo when the backend didn't say). */
  async checkScopes(): Promise<string[]> {
    if (this.scopes) return this.scopes;
    const t = await this.driveToken();
    if (!this.scopes) this.scopes = await tokenScopes(t).catch(() => []);
    return this.scopes ?? [];
  }

  /**
   * Incremental consent: ask Google for read access to the whole Drive on top
   * of what was granted. The backend keeps the new refresh token, so every
   * device gets it. Returns false when the user said no.
   */
  async connectWholeDrive(): Promise<boolean> {
    if (!this.user) return false;
    this.busy = true;
    this.error = '';
    try {
      const r = await googleSignIn({ code: await requestCode({ consent: true, hint: this.user.email, scopes: [DRIVE_READONLY_SCOPE] }) });
      if (!r.accessToken) return false;
      this.keep(r.accessToken, r.expiresIn, r.scope);
      if (!r.scope) this.scopes = await tokenScopes(r.accessToken).catch(() => []);
      if (!this.wholeDrive) this.error = 'Google did not grant access to the whole Drive (tick the Drive box on the consent screen).';
      return this.wholeDrive;
    } catch (e) {
      if ((e as Error).name === 'SignInCancelled') return false;
      if (/popup/i.test(String((e as Error).message))) await redirectForCode({ consent: true, hint: this.user.email, scopes: [DRIVE_READONLY_SCOPE] });
      this.error = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      this.busy = false;
    }
  }

  async signOut(): Promise<void> {
    this.token = null;
    this.scopes = null;
    await signOut(auth);
  }

  /** A Drive access token, refreshed through the backend a minute before it expires. */
  readonly driveToken = async (force = false): Promise<string> => {
    if (!force && this.token && this.token.expires - 60_000 > Date.now()) return this.token.value;
    try {
      const r = await driveToken({});
      this.keep(r.accessToken, r.expiresIn, r.scope);
      return r.accessToken;
    } catch (e) {
      if (/drive-not-connected|failed-precondition/.test(String((e as { code?: string }).code ?? '') + String((e as Error).message))) {
        // The stored connection was revoked: one consent popup fixes it.
        const r = await googleSignIn({ code: await requestCode({ consent: true, hint: this.user?.email }) });
        if (!r.accessToken) throw e;
        this.keep(r.accessToken, r.expiresIn, r.scope);
        return r.accessToken;
      }
      throw e;
    }
  };
}

export const account = new AccountState();
void account.finishRedirect();
if (import.meta.env.DEV) (window as unknown as { __account?: AccountState }).__account = account;
