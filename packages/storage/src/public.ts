import { unpack, type ProjectFile } from './file.ts';
import { readMedia, type ReadVia } from './driveapi.ts';
import { readAccess, type FileAccess } from './share.ts';
import { isSharedAssetId, type AssetCache } from './drive.ts';

/**
 * A design shared "anyone with the link", read without signing in (the public
 * `/view/<fileId>` page): the `.dcanvas` file and the assets its links.json
 * points at, all with the API key (OAuth first when a token is given).
 * Assets that can't be read are left out; the renderer draws a placeholder.
 */
export async function openPublicDesign(fileId: string, via: ReadVia, cache?: AssetCache): Promise<{ file: ProjectFile; access: FileAccess | null; missing: string[] }> {
  const [bytes, access] = await Promise.all([readMedia(fileId, via), readAccess(fileId, via).catch(() => null)]);
  const file = unpack(bytes);
  const links = file.links ?? {};
  const queue = Object.keys(file.doc.assets).filter((a) => !file.assets.has(a) && isSharedAssetId(a));
  const missing: string[] = [];
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, async () => {
    for (let a = queue.shift(); a; a = queue.shift()) {
      let b = await cache?.get(a).catch(() => undefined);
      const linked = links[a];
      if (!b && linked) {
        b = await readMedia(linked, via).catch(() => undefined);
        if (b) void cache?.set(a, b).catch(() => {});
      }
      if (b) file.assets.set(a, b);
      else missing.push(a);
    }
  }));
  return { file, access, missing };
}
