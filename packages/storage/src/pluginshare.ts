/**
 * Sharing one plugin by link: its `.dcplugin` goes into the user's Digital
 * Canvas folder in Drive (`drive.file` covers files the app makes), is made
 * "anyone with the link: reader" like a shared design (share.ts), and the link
 * `/plugin/<fileId>` opens the app's install screen, which reads the file with
 * the API key, so the recipient needs no access to the sharer's Drive.
 *
 * Sharing the same plugin again updates the same file, so old links get the
 * new version.
 */
import type { Plugin } from '@digital-canvas/scene';
import { API, driveCall, readMedia, type ReadVia, type TokenSource } from './driveapi.ts';
import { DriveSharing, SHARE_ORIGIN } from './share.ts';
import { PLUGIN_EXT, PLUGIN_MIME, unpackPlugin } from './plugins.ts';

const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
/** On a shared `.dcplugin`: the plugin id. */
const SHARE_PROP = 'dcPluginShare';

/** A file name for a plugin (Drive and downloads). */
export function pluginFileName(p: Pick<Plugin, 'name'>): string {
  return `${p.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '').trim().slice(0, 80) || 'Plugin'}${PLUGIN_EXT}`;
}

/** The install link of a shared plugin file. */
export function pluginLink(fileId: string, origin = SHARE_ORIGIN): string {
  return `${origin.replace(/\/$/, '')}/plugin/${encodeURIComponent(fileId)}`;
}

/** Upload (or update) the plugin's `.dcplugin` in `folderId` and make it readable by link. Returns the Drive file id. */
export async function sharePluginFile(token: TokenSource, folderId: string, plugin: Plugin, bytes: Uint8Array): Promise<string> {
  const q = `'${folderId}' in parents and trashed=false and appProperties has { key='${SHARE_PROP}' and value='${plugin.id}' }`;
  const found = (await (await driveCall(token, `${API}/files?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive' })}`)).json()) as { files?: { id: string }[] };
  const id = found.files?.[0]?.id;
  const meta: Record<string, unknown> = { name: pluginFileName(plugin), mimeType: PLUGIN_MIME, appProperties: { [SHARE_PROP]: plugin.id } };
  if (!id) meta.parents = [folderId];
  const boundary = `dc${Math.random().toString(36).slice(2)}`;
  const enc = new TextEncoder();
  const head = enc.encode(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\ncontent-type: ${PLUGIN_MIME}\r\n\r\n`);
  const tail = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0); body.set(bytes, head.length); body.set(tail, head.length + bytes.length);
  const url = id ? `${UPLOAD}/files/${id}?uploadType=multipart&fields=id` : `${UPLOAD}/files?uploadType=multipart&fields=id`;
  const r = (await (await driveCall(token, url, { method: id ? 'PATCH' : 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body })).json()) as { id: string };
  await new DriveSharing(token).setLinkAccess(r.id, 'reader');
  return r.id;
}

/** Read a shared `.dcplugin` (OAuth first, then the API key). */
export async function readSharedPlugin(fileId: string, via: ReadVia): Promise<ReturnType<typeof unpackPlugin>> {
  return unpackPlugin(await readMedia(fileId, via));
}
