import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Digital Canvas native shells: the built web app (apps/web/dist) inside a WebView.
 * Run `npm run build -w @digital-canvas/web` then `npx cap sync` here.
 */
const config: CapacitorConfig = {
  appId: 'com.panth977.digitalcanvas',
  appName: 'Digital Canvas',
  webDir: '../web/dist',
  // Keep fetch/XHR in the WebView (Drive binary uploads). Only the Cloud Functions
  // calls are routed through CapacitorHttp, by apps/web/src/lib/native/http.ts.
  plugins: {
    CapacitorHttp: { enabled: false },
    SplashScreen: { launchShowDuration: 600, launchAutoHide: true, backgroundColor: '#7d2ae8', showSpinner: false },
    // Edge to edge (Capacitor 8 core SystemBars): the page draws under the status and
    // navigation bars; index.html has viewport-fit=cover, so CSS env(safe-area-inset-*)
    // is correct on both platforms (and Android also gets --safe-area-inset-* variables).
    // DARK = light icons, for the gradient header.
    SystemBars: { insetsHandling: 'css', initialViewportFitValueHint: 'cover', style: 'DARK' },
  },
  ios: {
    contentInset: 'never',
    scheme: 'capacitor',
  },
};

export default config;
