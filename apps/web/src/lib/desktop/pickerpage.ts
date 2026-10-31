/**
 * Google Picker for the desktop app. Google won't draw it inside an embedded
 * webview, so the app opens this page in the real browser, on the app's own
 * local origin; the page takes a one-time session and posts the choice back.
 */
const nonce = new URLSearchParams(location.search).get('n') ?? '';

const say = (text: string) => { document.body.style.cssText = 'font:16px system-ui;display:grid;place-items:center;height:90vh;margin:0'; document.body.textContent = text; };

let sent = false;
const send = (result: unknown) => {
  if (sent) return Promise.resolve();
  sent = true;
  return fetch('/desktop/api/picker/result', { method: 'POST', body: JSON.stringify({ nonce, result }) }).catch(() => {});
};

export async function runPickerPage(): Promise<void> {
  say('Opening Google Drive…');
  // Closing the tab counts as cancelling: the app must not wait for nothing.
  addEventListener('pagehide', () => { if (!sent) { sent = true; navigator.sendBeacon('/desktop/api/picker/result', JSON.stringify({ nonce, result: null })); } });
  const r = await fetch('/desktop/api/picker/session', { method: 'POST', body: JSON.stringify({ nonce }) });
  if (!r.ok) return say('This link has already been used. Go back to Digital Canvas.');
  const s = (await r.json()) as { mode: 'media' | 'design' | 'file'; arg?: string; token: string };
  try {
    const { openPicker, pickDesignFile, pickSharedFile } = await import('../picker.ts');
    const result = s.mode === 'media' ? await openPicker(s.token) : s.mode === 'file' ? await pickSharedFile(s.token, s.arg!) : await pickDesignFile(s.token, s.arg as 'shared' | 'import');
    await send(result);
    say('Done. Go back to Digital Canvas; you can close this tab.');
    close();
  } catch (e) {
    await send(null);
    say(e instanceof Error ? e.message : String(e));
  }
}
