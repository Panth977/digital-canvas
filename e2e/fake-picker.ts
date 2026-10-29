import type { Page } from '@playwright/test';

/**
 * A stand-in for Google Picker (`window.google.picker`), installed before the
 * app runs, so lib/picker.ts never loads Google's api.js. `setVisible(true)`
 * shows a full-screen overlay (data-testid=fake-picker) and records how the
 * picker was built in `window.__fakePicker`; the test answers with
 * `respond(page, docs)` (or `cancel(page)`).
 */
export interface FakePickerState {
  appId?: string;
  key?: string;
  token?: string;
  origin?: string;
  size?: [number, number];
  features: string[];
  views: { id: string; label?: string; fileIds?: string; parent?: string; ownedByMe?: boolean; starred?: boolean; drives?: boolean; folders?: boolean; mimes?: string }[];
  opened: number;
}

export async function installFakePicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state: any = { features: [], views: [], opened: 0, callback: null };
    (window as any).__fakePicker = state;
    class DocsView {
      v: any;
      constructor(id = 'all') { this.v = { id }; }
      setParent(p: string) { this.v.parent = p; return this; }
      setIncludeFolders(b: boolean) { this.v.folders = b; return this; }
      setSelectFolderEnabled() { return this; }
      setOwnedByMe(b: boolean) { this.v.ownedByMe = b; return this; }
      setStarred(b: boolean) { this.v.starred = b; return this; }
      setEnableDrives(b: boolean) { this.v.drives = b; return this; }
      setMimeTypes(m: string) { this.v.mimes = m; return this; }
      setLabel(l: string) { this.v.label = l; return this; }
      setFileIds(ids: string) { this.v.fileIds = ids; return this; }
    }
    class PickerBuilder {
      constructor() { state.views = []; state.features = []; }
      setAppId(a: string) { state.appId = a; return this; }
      setDeveloperKey(k: string) { state.key = k; return this; }
      setOAuthToken(t: string) { state.token = t; return this; }
      setOrigin(o: string) { state.origin = o; return this; }
      setTitle() { return this; }
      setSize(w: number, h: number) { state.size = [w, h]; return this; }
      setMaxItems() { return this; }
      enableFeature(f: string) { state.features.push(f); return this; }
      addView(view: any) { state.views.push(view.v); return this; }
      setCallback(cb: (r: unknown) => void) { state.callback = cb; return this; }
      build() {
        return {
          setVisible(v: boolean) {
            if (!v) return;
            state.opened++;
            const o = document.createElement('div');
            o.dataset.testid = 'fake-picker';
            o.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);display:grid;place-items:center;font:600 16px system-ui;color:#fff';
            o.innerHTML = '<div style="background:#fff;color:#202124;border-radius:12px;padding:24px 28px;width:min(640px,90vw);height:min(420px,80vh);box-shadow:0 8px 30px rgba(0,0,0,.4)"><div style="font-size:20px">Choose from Google Drive</div><div style="margin-top:8px;font-weight:400;color:#5f6368">(Google Picker stand-in for tests)</div></div>';
            document.body.append(o);
            setTimeout(() => state.callback?.({ action: 'loaded' }));
          },
          dispose() { document.querySelector('[data-testid=fake-picker]')?.remove(); },
        };
      }
    }
    (window as any).google = Object.assign((window as any).google ?? {}, {
      picker: {
        PickerBuilder,
        DocsView,
        ViewId: { DOCS: 'all', DOCS_IMAGES: 'docs-images', DOCS_VIDEOS: 'docs-videos' },
        Feature: { MULTISELECT_ENABLED: 'multiselect', SUPPORT_DRIVES: 'support-drives' },
        Action: { PICKED: 'picked', CANCEL: 'cancel', ERROR: 'error' },
      },
    });
  });
}

/** The user picks these files in the (fake) Picker. */
export async function respond(page: Page, docs: { id: string; name: string; mimeType: string; sizeBytes?: number }[]): Promise<void> {
  await page.evaluate((docs) => (window as any).__fakePicker.callback({ action: 'picked', docs }), docs);
}

export async function cancel(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__fakePicker.callback({ action: 'cancel' }));
}

export function pickerState(page: Page): Promise<FakePickerState> {
  return page.evaluate(() => {
    const { callback, ...rest } = (window as any).__fakePicker;
    return JSON.parse(JSON.stringify(rest));
  });
}
