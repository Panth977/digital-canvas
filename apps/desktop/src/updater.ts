/**
 * Updates for the desktop app: look for a newer GitHub Release, and when the
 * user says "Update now", download this platform's file and put it in place.
 *
 * Nothing installs by itself: the app finds the update, the user chooses.
 * The builds are not signed with a Developer ID (Squirrel/electron-updater
 * need that on macOS), so the swap is done here:
 *
 * - macOS: mount the .dmg, copy the .app out, unmount; a small script waits
 *   for this app to quit, swaps the bundle and opens the new one. Files we
 *   download ourselves carry no quarantine flag, so Gatekeeper does not stop
 *   the new version (the first install from the browser still does).
 * - Windows: run the NSIS installer silently (`/S --force-run` starts the new
 *   version when it is done) and quit.
 * - Linux AppImage: replace the AppImage file and start it. A .deb install
 *   opens the downloaded package in the system installer.
 *
 * When the swap can't be done (the app sits somewhere we may not write, a
 * .deb), the downloaded file opens for a manual install instead.
 */
import { spawn, execFile } from 'node:child_process';
import { accessSync, chmodSync, constants, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { isNewer } from './version.ts';

const run = promisify(execFile);

export interface ReleaseAsset { name: string; browser_download_url: string; size: number }
export interface Release { tag_name?: string; html_url?: string; body?: string; assets?: ReleaseAsset[]; draft?: boolean; prerelease?: boolean }

export interface UpdateInfo {
  version: string;
  /** The release page. */
  url: string;
  notes?: string;
  /** This platform's file, when the release has one (else only the page can help). */
  asset?: { name: string; url: string; size: number };
}

export interface UpdateState extends UpdateInfo {
  phase: 'available' | 'downloading' | 'installing' | 'manual' | 'error';
  /** 0..1 while downloading. */
  progress?: number;
  error?: string;
}

/** The release file for this platform and CPU (names from electron-builder.yml). */
export function assetFor(assets: ReleaseAsset[], platform: string, arch: string, appImage = false): ReleaseAsset | undefined {
  const by = (n: string) => assets.find((a) => a.name === n);
  if (platform === 'darwin') return by(`Digital-Canvas-mac-${arch === 'arm64' ? 'arm64' : 'x64'}.dmg`);
  if (platform === 'win32') return by('Digital-Canvas-windows-x64.exe');
  if (platform === 'linux') return appImage ? by('Digital-Canvas-linux-x86_64.AppImage') ?? by('Digital-Canvas-linux-x64.AppImage') : by('Digital-Canvas-linux-amd64.deb') ?? by('Digital-Canvas-linux-x64.deb');
  return undefined;
}

/** What a release means for the version we run: an update, or nothing. */
export function updateFrom(r: Release, current: string, platform: string, arch: string, appImage = false): UpdateInfo | null {
  if (!r.tag_name || r.draft || r.prerelease || !isNewer(r.tag_name, current)) return null;
  const a = assetFor(r.assets ?? [], platform, arch, appImage);
  return {
    version: r.tag_name.replace(/^v/, ''),
    url: r.html_url ?? '',
    ...(r.body ? { notes: r.body.slice(0, 4000) } : {}),
    ...(a ? { asset: { name: a.name, url: a.browser_download_url, size: a.size } } : {}),
  };
}

/** The .app bundle this process runs from (macOS), from the executable path. */
export function bundleOf(exe: string): string | null {
  const m = /^(.*?\.app)\/Contents\/MacOS\/[^/]+$/.exec(exe);
  return m ? m[1]! : null;
}

/** The shell script that swaps the bundle once the app has quit, then opens the new one. */
export function macSwapScript(pid: number, bundle: string, fresh: string, log: string, openCmd = 'open'): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  return `#!/bin/sh
exec >>${q(log)} 2>&1
echo "update: waiting for ${pid}"
i=0
while kill -0 ${pid} 2>/dev/null; do i=$((i+1)); [ $i -gt 600 ] && exit 1; sleep 0.1; done
rm -rf ${q(`${bundle}.old`)}
if mv ${q(bundle)} ${q(`${bundle}.old`)} && mv ${q(fresh)} ${q(bundle)}; then
  rm -rf ${q(`${bundle}.old`)}
  echo "update: swapped"
else
  echo "update: swap failed, putting the old app back"
  [ -d ${q(bundle)} ] || mv ${q(`${bundle}.old`)} ${q(bundle)}
fi
xattr -dr com.apple.quarantine ${q(bundle)} 2>/dev/null
${openCmd} ${q(bundle)}
`;
}

function writable(dir: string): boolean {
  try { accessSync(dir, constants.W_OK); return true; } catch { return false; }
}

/** Download with progress; `onProgress(0..1)`. */
export async function download(url: string, to: string, size: number, onProgress: (p: number) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, { signal, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`);
  const total = Number(res.headers.get('content-length')) || size || 0;
  let got = 0;
  const body = Readable.fromWeb(res.body as never);
  body.on('data', (c: Buffer) => { got += c.length; if (total) onProgress(Math.min(1, got / total)); });
  mkdirSync(dirname(to), { recursive: true });
  const part = `${to}.part`;
  await pipeline(body, createWriteStream(part));
  if (total && got !== total) throw new Error('The download was cut short. Try again.');
  renameSync(part, to);
}

export interface InstallEnv {
  platform: string;
  exe: string;
  pid: number;
  /** Where downloads and the staged app go. */
  workDir: string;
  appImage?: string;
  /** Opens a file with the system (manual install). */
  openPath(path: string): Promise<string>;
  /** Quit this app (the swap runs after). */
  quit(): void;
  /** Tests: what starts the new app (default `open`). */
  openCmd?: string;
}

/**
 * Put the downloaded file in place. Returns 'restarting' when the app will
 * quit and come back as the new version, or 'manual' when the downloaded
 * file was opened for the user to install.
 */
export async function install(file: string, env: InstallEnv): Promise<'restarting' | 'manual'> {
  if (env.platform === 'darwin') {
    const bundle = bundleOf(env.exe);
    if (!bundle || !writable(dirname(bundle)) || bundle.includes('/AppTranslocation/')) {
      await env.openPath(file);
      return 'manual';
    }
    const mnt = join(env.workDir, 'mnt');
    rmSync(mnt, { recursive: true, force: true });
    mkdirSync(mnt, { recursive: true });
    await run('hdiutil', ['attach', '-nobrowse', '-noautoopen', '-readonly', '-mountpoint', mnt, file]);
    // stage next to the installed app: the final `mv` is then a rename on one volume
    const fresh = `${bundle}.new`;
    try {
      const app = readdirSync(mnt).find((n) => n.endsWith('.app'));
      if (!app) throw new Error('The update has no app inside.');
      rmSync(fresh, { recursive: true, force: true });
      await run('ditto', [join(mnt, app), fresh]);
    } finally {
      await run('hdiutil', ['detach', mnt, '-force']).catch(() => {});
    }
    const script = join(env.workDir, 'swap.sh');
    writeFileSync(script, macSwapScript(env.pid, bundle, fresh, join(env.workDir, 'update.log'), env.openCmd), { mode: 0o755 });
    spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' }).unref();
    env.quit();
    return 'restarting';
  }
  if (env.platform === 'win32') {
    spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
    env.quit();
    return 'restarting';
  }
  if (env.platform === 'linux' && env.appImage && file.endsWith('.AppImage') && writable(dirname(env.appImage))) {
    chmodSync(file, 0o755);
    const staged = `${env.appImage}.new`;
    rmSync(staged, { force: true });
    await run('cp', [file, staged]);
    renameSync(staged, env.appImage);
    spawn(env.appImage, [], { detached: true, stdio: 'ignore' }).unref();
    env.quit();
    return 'restarting';
  }
  await env.openPath(file);
  return 'manual';
}

/** Leftovers of a finished update (a `.new` bundle that was never swapped, old downloads). */
export function cleanup(workDir: string, exe: string): void {
  const bundle = bundleOf(exe);
  if (bundle && existsSync(`${bundle}.new`)) rmSync(`${bundle}.new`, { recursive: true, force: true });
  rmSync(join(workDir, 'mnt'), { recursive: true, force: true });
}
