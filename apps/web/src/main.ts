// First: a Google sign-in for the native app lands here in the system browser
// and is handed straight back to the app (nothing else boots).
import { bounced } from './lib/native/bounce.ts';
import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { isNative } from './lib/native/platform.ts';
import { installNativeFetch } from './lib/native/http.ts';
import { registerServiceWorker } from './lib/pwa.ts';

if (isNative()) {
  installNativeFetch();
  void import('./lib/native/links.ts').then((m) => m.installAppLinks());
}
if (!bounced && location.pathname !== '/desktop/picker') registerServiceWorker();

// Desktop: Google's Picker page, opened in the real browser (nothing else boots there).
const pickerPage = location.pathname === '/desktop/picker';
if (pickerPage) void import('./lib/desktop/pickerpage.ts').then((m) => m.runPickerPage());

export default bounced || pickerPage ? undefined : mount(App, { target: document.getElementById('app')! });
