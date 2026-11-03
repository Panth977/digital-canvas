import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FolderWorkspace } from '@digital-canvas/mcp';
import { libraryJson, readLibrary } from '@digital-canvas/storage';
import { folderApi } from '../src/folderops.ts';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('desktop folder ops: plugins', () => {
  it('saves the library and plugin files in the folder and reads them back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dc-plugins-'));
    dirs.push(dir);
    const api = folderApi(new FolderWorkspace(dir));
    expect(readLibrary(await api.loadPlugins()).plugins).toEqual([]);
    const lib = readLibrary(JSON.stringify({ format: 'digital-canvas-plugins', version: 1, updatedAt: '', plugins: [
      { id: 'pl_font1234', kind: 'font', name: 'Mine', family: 'Mine', faces: [{ asset: 'aaaaaaaaaaaaaaaaaaaa.ttf', mime: 'font/ttf', weight: 400 }] },
    ] }));
    await api.savePlugins(libraryJson(lib), [['aaaaaaaaaaaaaaaaaaaa.ttf', new Uint8Array([1, 2, 3])]]);
    expect(readLibrary(await api.loadPlugins()).plugins.map((p) => p.name)).toEqual(['Mine']);
    expect(await api.pluginAsset('aaaaaaaaaaaaaaaaaaaa.ttf')).toEqual(new Uint8Array([1, 2, 3]));
    expect(await api.pluginAsset('missing.ttf')).toBeNull();
  });
});
