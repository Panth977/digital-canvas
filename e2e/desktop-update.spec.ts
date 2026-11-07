/**
 * The desktop app updates itself, for real (macOS, opt-in): a packaged OLD app
 * finds a newer release on a local stand-in for GitHub, the user clicks
 * Update now, the app downloads the .dmg, quits, its bundle is swapped and
 * the new version starts.
 *
 *   DC_UPDATE_OLD_APP="/tmp/x/Digital Canvas.app"  (packaged with an older version, e.g. --dir -c.extraMetadata.version=0.1.98)
 *   DC_UPDATE_NEW_DMG=/tmp/y/Digital-Canvas-mac-arm64.dmg  (packaged with a newer one, e.g. 0.1.99)
 *   npx playwright test e2e/desktop-update.spec.ts
 */
import { cpSync, createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

const OLD = process.env.DC_UPDATE_OLD_APP, DMG = process.env.DC_UPDATE_NEW_DMG;
test.skip(process.platform !== 'darwin' || !OLD || !DMG, 'set DC_UPDATE_OLD_APP and DC_UPDATE_NEW_DMG (macOS)');

const version = (app: string) => execFileSync('defaults', ['read', join(app, 'Contents/Info'), 'CFBundleShortVersionString'], { encoding: 'utf8' }).trim();

test('Update now: download, swap, the new version starts', async () => {
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), 'dc-update-'));
  const app = join(dir, 'Applications', 'Digital Canvas.app');
  cpSync(OLD!, app, { recursive: true, verbatimSymlinks: true });
  const before = version(app);
  const size = statSync(DMG!).size;
  let server: Server | undefined;
  try {
    server = createServer((req, res) => {
      const port = (server!.address() as { port: number }).port;
      if (req.url === '/release') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ tag_name: 'v0.1.99', html_url: 'https://example.invalid/r', body: 'Comments and updates.', assets: [{ name: basename(DMG!), size, browser_download_url: `http://127.0.0.1:${port}/dmg` }] }));
      } else if (req.url === '/dmg') {
        res.setHeader('content-length', String(size));
        createReadStream(DMG!).pipe(res);
      } else res.writeHead(404).end();
    }).listen(0, '127.0.0.1');
    await new Promise((r) => server!.once('listening', r));
    const port = (server.address() as { port: number }).port;
    const ea = await electron.launch({
      executablePath: join(app, 'Contents/MacOS/Digital Canvas'),
      env: { ...process.env, DC_DESKTOP_USER_DATA: join(dir, 'userdata'), DC_DESKTOP_PORT: '5299', DC_DESKTOP_BLOCK_NETWORK: '1', DC_OFFLINE: '1', DC_DESKTOP_RELEASES_API: `http://127.0.0.1:${port}/release` } as Record<string, string>,
    });
    const page = await ea.firstWindow();
    const banner = page.getByTestId('update-banner');
    await expect(banner).toBeVisible({ timeout: 30_000 }); // the check runs 8 s after start
    await expect(banner).toContainText('Digital Canvas 0.1.99 is available');
    await expect(banner).toContainText(`You have ${before}`);
    await page.screenshot({ path: '/tmp/orch44/update-banner.png' });
    const closed = new Promise((r) => ea.once('close', r));
    await page.getByTestId('update-now').click();
    await closed; // the app quits itself to be swapped
    await expect.poll(() => (existsSync(app) ? version(app) : ''), { timeout: 60_000, intervals: [500] }).toBe('0.1.99');
    expect(existsSync(`${app}.old`)).toBe(false);
    expect(existsSync(`${app}.new`)).toBe(false);
  } finally {
    server?.close();
    // the new version was started with `open`: stop it
    try { execFileSync('pkill', ['-f', join(app, 'Contents/MacOS')]); } catch { /* not running */ }
    rmSync(dir, { recursive: true, force: true });
  }
});
