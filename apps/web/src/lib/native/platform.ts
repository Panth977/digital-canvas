/**
 * Are we inside the Capacitor shell (apps/mobile)? The shell injects
 * `window.Capacitor` before the page runs, so browsers never load
 * `@capacitor/core` for this check. Native plugins are imported dynamically,
 * only behind `isNative()`.
 */
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

function cap(): CapacitorGlobal | undefined {
  return typeof window === 'undefined' ? undefined : (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

export function isNative(): boolean {
  return !!cap()?.isNativePlatform?.();
}

export function nativePlatform(): 'ios' | 'android' | 'web' {
  const p = cap()?.getPlatform?.();
  return p === 'ios' || p === 'android' ? p : 'web';
}

/** The app's custom URL scheme (iOS CFBundleURLSchemes, Android intent-filter). */
export const APP_SCHEME = 'com.panth977.digitalcanvas';
/** OAuth `state` prefix that marks a sign-in started by the native app. */
export const APP_STATE_PREFIX = 'dcapp.';
/** The hosted web app's callback, registered for the web OAuth client and accepted by the backend. */
export const HOSTED_CALLBACK = 'https://digital-canvas-p977.web.app/auth/callback';
