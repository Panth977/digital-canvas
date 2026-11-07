import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assetFor, bundleOf, install, updateFrom, type ReleaseAsset } from '../src/updater.ts';

const NAMES = ['Digital-Canvas-linux-amd64.deb', 'Digital-Canvas-linux-x86_64.AppImage', 'Digital-Canvas-mac-arm64.dmg', 'Digital-Canvas-mac-x64.dmg', 'Digital-Canvas-windows-x64.exe'];
const assets: ReleaseAsset[] = NAMES.map((name, i) => ({ name, browser_download_url: `https://dl/${name}`, size: 100 + i }));

describe('which release file', () => {
  it('picks this platform and CPU (names as v0.1.4 published them)', () => {
    expect(assetFor(assets, 'darwin', 'arm64')?.name).toBe('Digital-Canvas-mac-arm64.dmg');
    expect(assetFor(assets, 'darwin', 'x64')?.name).toBe('Digital-Canvas-mac-x64.dmg');
    expect(assetFor(assets, 'win32', 'x64')?.name).toBe('Digital-Canvas-windows-x64.exe');
    expect(assetFor(assets, 'linux', 'x64', true)?.name).toBe('Digital-Canvas-linux-x86_64.AppImage');
    expect(assetFor(assets, 'linux', 'x64')?.name).toBe('Digital-Canvas-linux-amd64.deb');
    expect(assetFor(assets, 'freebsd', 'x64')).toBeUndefined();
  });

  it('only newer, published releases are updates', () => {
    const r = { tag_name: 'v0.1.5', html_url: 'https://gh/r', body: 'notes', assets };
    expect(updateFrom(r, '0.1.4', 'darwin', 'arm64')).toEqual({ version: '0.1.5', url: 'https://gh/r', notes: 'notes', asset: { name: 'Digital-Canvas-mac-arm64.dmg', url: 'https://dl/Digital-Canvas-mac-arm64.dmg', size: 102 } });
    expect(updateFrom(r, '0.1.5', 'darwin', 'arm64')).toBeNull();
    expect(updateFrom(r, '0.2.0', 'darwin', 'arm64')).toBeNull();
    expect(updateFrom({ ...r, prerelease: true }, '0.1.4', 'darwin', 'arm64')).toBeNull();
    expect(updateFrom({ ...r, assets: [] }, '0.1.4', 'darwin', 'arm64')?.asset).toBeUndefined();
  });

  it('finds the .app bundle from the executable', () => {
    expect(bundleOf('/Applications/Digital Canvas.app/Contents/MacOS/Digital Canvas')).toBe('/Applications/Digital Canvas.app');
    expect(bundleOf('/usr/bin/digital-canvas')).toBeNull();
  });
});

describe.runIf(process.platform === 'darwin')('macOS install (real hdiutil, a fake app)', () => {
  it('mounts the dmg, stages the app, swaps it once the old process is gone, starts the new one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dc-upd-'));
    try {
      const mk = (root: string, v: string) => {
        mkdirSync(join(root, 'Fake.app/Contents/MacOS'), { recursive: true });
        writeFileSync(join(root, 'Fake.app/Contents/version.txt'), v);
        writeFileSync(join(root, 'Fake.app/Contents/MacOS/Fake'), '#!/bin/sh\n');
      };
      const installed = join(dir, 'Applications');
      mk(installed, 'old');
      const src = join(dir, 'src');
      mk(src, 'new');
      const dmg = join(dir, 'update.dmg');
      execFileSync('hdiutil', ['create', '-quiet', '-fs', 'HFS+', '-srcfolder', src, '-volname', 'Fake', dmg]);
      const old = spawn('sleep', ['1']); // stands in for the running app
      const opened = join(dir, 'opened.txt');
      const opener = join(dir, 'opener.sh');
      writeFileSync(opener, `#!/bin/sh\necho "$1" > '${opened}'\n`, { mode: 0o755 });
      let quit = false;
      const how = await install(dmg, {
        platform: 'darwin', exe: join(installed, 'Fake.app/Contents/MacOS/Fake'), pid: old.pid!, workDir: join(dir, 'work'),
        openPath: async () => '', quit: () => { quit = true; }, openCmd: opener,
      });
      expect(how).toBe('restarting');
      expect(quit).toBe(true);
      expect(readFileSync(join(installed, 'Fake.app/Contents/version.txt'), 'utf8')).toBe('old'); // not before the app quits
      for (let i = 0; i < 50 && !existsSync(opened); i++) await new Promise((r) => setTimeout(r, 100));
      expect(readFileSync(join(installed, 'Fake.app/Contents/version.txt'), 'utf8')).toBe('new');
      expect(readFileSync(opened, 'utf8').trim()).toBe(join(installed, 'Fake.app'));
      expect(existsSync(join(installed, 'Fake.app.old'))).toBe(false);
      expect(existsSync(join(installed, 'Fake.app.new'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('an app it may not replace (no bundle) opens the download instead', async () => {
    let opened = '';
    const how = await install('/tmp/x.dmg', { platform: 'darwin', exe: '/usr/local/bin/dc', pid: 1, workDir: tmpdir(), openPath: async (f) => { opened = f; return ''; }, quit: () => { throw new Error('must not quit'); } });
    expect(how).toBe('manual');
    expect(opened).toBe('/tmp/x.dmg');
  });
});
