import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GOOGLE_SCOPES } from '@digital-canvas/backend/google';

/**
 * Digital Canvas only ever asks Google for `drive.file` (files it creates or the
 * user picks with Google Picker). The restricted `drive.readonly` scope, the
 * whole-Drive `drive` scope and tokeninfo scope checks must not come back:
 * they trigger Google's "unverified app" screens.
 */
const ROOT = join(__dirname, '../../..');
const DIRS = ['apps/web/src', 'apps/web/public', 'apps/web/index.html', 'apps/mobile/capacitor.config.ts', 'apps/mobile/scripts', 'backend/functions/src', 'backend/mcp', 'backend/icebase', 'backend/google.ts', 'backend/icebase.config.ts', 'packages/storage/src', 'packages/mcp/src'];
const CODE = /\.(ts|js|mjs|svelte|html|json)$/;

function files(path: string): string[] {
  const full = join(ROOT, path);
  let st;
  try { st = statSync(full); } catch { return []; }
  if (st.isFile()) return CODE.test(full) ? [full] : [];
  return readdirSync(full).flatMap((n) => (n === 'node_modules' || n === 'dist' || n === 'lib' || n.startsWith('.') ? [] : files(join(path, n))));
}

describe('Google Drive scope', () => {
  it('sign-in asks for drive.file only', () => {
    expect(GOOGLE_SCOPES.filter((s) => s.includes('/auth/drive'))).toEqual(['https://www.googleapis.com/auth/drive.file']);
  });

  it('no code asks for drive.readonly, the whole Drive, or checks scopes with tokeninfo', () => {
    const all = DIRS.flatMap(files);
    expect(all.length).toBeGreaterThan(50);
    const bad: string[] = [];
    for (const f of all) {
      const text = readFileSync(f, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (/drive\.readonly|googleapis\.com\/auth\/drive(?![.\w-])|oauth2\/v\d\/tokeninfo|googleapis\.com\/tokeninfo|tokeninfo\?/.test(line)) bad.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
