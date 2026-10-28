import { GOOGLE_APP_ID, PICKER_API_KEY } from '@digital-canvas/backend/google';
import { pickedFiles, type PickedFile, type PickerDoc } from '@digital-canvas/storage';

/**
 * Google Picker (https://developers.google.com/drive/picker): Google's own
 * "choose files from Drive" dialog. Whatever the user picks is granted to this
 * app under `drive.file`, so the app never needs read access to the whole
 * Drive (no restricted scope, no "unverified app" screen).
 *
 * Browsers only: Google no longer shows the Picker inside an embedded WebView,
 * so the Capacitor app uses the system file picker instead (UploadsPanel).
 *
 * e2e tests replace `window.google.picker` with a fake (page.addInitScript);
 * when it is already there, nothing is loaded.
 */

/** The parts of `google.picker` we use. */
interface View {
  setMimeTypes?(m: string): View;
  setLabel?(l: string): View;
}
interface DocsView extends View {
  setParent(id: string): DocsView;
  setIncludeFolders(b: boolean): DocsView;
  setSelectFolderEnabled(b: boolean): DocsView;
  setOwnedByMe(b: boolean): DocsView;
  setStarred(b: boolean): DocsView;
  setEnableDrives(b: boolean): DocsView;
  setMode?(m: string): DocsView;
}
interface Builder {
  setAppId(id: string): Builder;
  setDeveloperKey(k: string): Builder;
  setOAuthToken(t: string): Builder;
  setOrigin(o: string): Builder;
  setTitle(t: string): Builder;
  setSize(w: number, h: number): Builder;
  setMaxItems?(n: number): Builder;
  enableFeature(f: string): Builder;
  addView(v: View | string): Builder;
  setCallback(cb: (r: PickerResponse) => void): Builder;
  build(): { setVisible(v: boolean): void; dispose?(): void };
}
interface PickerResponse { action: string; docs?: PickerDoc[] }
export interface PickerApi {
  PickerBuilder: new () => Builder;
  DocsView: new (viewId?: string) => DocsView;
  ViewId: Record<'DOCS' | 'DOCS_IMAGES' | 'DOCS_VIDEOS', string>;
  Feature: Record<'MULTISELECT_ENABLED' | 'SUPPORT_DRIVES', string>;
  Action: Record<'PICKED' | 'CANCEL' | 'ERROR', string>;
  DocsViewMode?: Record<'GRID' | 'LIST', string>;
}

const IMAGE = 'image/png,image/jpeg,image/jpg,image/webp,image/gif,image/svg+xml,image/heic,image/heif,image/avif,image/bmp';
const VIDEO = 'video/mp4,video/webm,video/quicktime,video/x-m4v,video/mpeg,video/3gpp';
const AUDIO = 'audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/m4a,audio/aac,audio/wav,audio/x-wav,audio/wave,audio/ogg,audio/webm,audio/flac';
/** What the editor can place. */
export const MEDIA_MIMES = [IMAGE, VIDEO, AUDIO].join(',');

let loading: Promise<PickerApi> | null = null;

function api(): PickerApi | undefined {
  return (window as unknown as { google?: { picker?: PickerApi } }).google?.picker;
}

/** Load Google's api.js and its "picker" module once. */
export function loadPicker(): Promise<PickerApi> {
  const ready = api();
  if (ready) return Promise.resolve(ready);
  loading ??= new Promise<PickerApi>((resolve, reject) => {
    const fail = () => { loading = null; reject(new Error('Could not load Google Drive. Check your connection and try again.')); };
    const s = Object.assign(document.createElement('script'), { src: 'https://apis.google.com/js/api.js', async: true });
    s.onload = () => {
      const gapi = (window as unknown as { gapi?: { load(name: string, cb: { callback: () => void; onerror: () => void }): void } }).gapi;
      if (!gapi) return fail();
      gapi.load('picker', { callback: () => (api() ? resolve(api()!) : fail()), onerror: fail });
    };
    s.onerror = fail;
    document.head.append(s);
  });
  return loading;
}

const label = <T extends View>(v: T, text: string): T => (v.setLabel?.(text) as T | undefined) ?? v;
const media = <T extends View>(v: T, mimes = MEDIA_MIMES): T => (v.setMimeTypes?.(mimes) as T | undefined) ?? v;

/**
 * Open the Picker: My Drive (folders, multi-select), Shared with me, Starred,
 * Recent, Shared drives, then Images / Videos / Audio; Google's search box on top.
 * Resolves with the usable media picked, or null when the user closed it.
 */
export async function openPicker(token: string, opts: { phone?: boolean } = {}): Promise<PickedFile[] | null> {
  const P = await loadPicker();
  const docs = () => new P.DocsView(P.ViewId.DOCS);
  const views: View[] = [
    label(media(docs().setParent('root').setIncludeFolders(true).setSelectFolderEnabled(false)), 'My Drive'),
    label(media(docs().setOwnedByMe(false).setIncludeFolders(true).setSelectFolderEnabled(false)), 'Shared with me'),
    label(media(docs().setStarred(true).setIncludeFolders(true).setSelectFolderEnabled(false)), 'Starred'),
    label(media(docs()), 'Recent'),
    label(media(docs().setEnableDrives(true).setIncludeFolders(true).setSelectFolderEnabled(false)), 'Shared drives'),
    label(new P.DocsView(P.ViewId.DOCS_IMAGES), 'Images'),
    label(new P.DocsView(P.ViewId.DOCS_VIDEOS), 'Videos'),
    label(media(docs(), AUDIO), 'Audio'),
  ];
  return new Promise((resolve, reject) => {
    let b = new P.PickerBuilder()
      .setAppId(GOOGLE_APP_ID)
      .setDeveloperKey((import.meta.env.VITE_PICKER_API_KEY as string | undefined) || PICKER_API_KEY)
      .setOAuthToken(token)
      .setOrigin(location.origin)
      .setTitle('Choose from Google Drive')
      .enableFeature(P.Feature.MULTISELECT_ENABLED)
      .enableFeature(P.Feature.SUPPORT_DRIVES);
    if (opts.phone) b = b.setSize(window.innerWidth, window.innerHeight);
    b = b.setMaxItems?.(50) ?? b;
    for (const v of views) b = b.addView(v);
    const picker = b
      .setCallback((r) => {
        if (r.action === P.Action.PICKED) resolve(pickedFiles(r.docs));
        else if (r.action === P.Action.CANCEL) resolve(null);
        else if (r.action === P.Action.ERROR) reject(new Error('Google Drive could not open the picker.'));
        if (r.action !== 'loaded') picker.dispose?.();
      })
      .build();
    picker.setVisible(true);
  });
}
