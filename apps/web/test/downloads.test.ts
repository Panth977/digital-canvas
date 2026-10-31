import { describe, expect, it } from 'vitest';
import { detectOs, downloads } from '../src/lib/downloads.ts';

describe('desktop downloads', () => {
  it('finds the OS', () => {
    expect(detectOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120')).toBe('mac');
    expect(detectOs('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(detectOs('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux');
    expect(detectOs('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('other');
    expect(detectOs('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('other');
  });
  it('links every platform to the latest release by a fixed name', () => {
    const ids = downloads().map((d) => d.id);
    expect(ids).toEqual(['mac-arm64', 'mac-x64', 'windows', 'linux-appimage', 'linux-deb']);
    for (const d of downloads()) expect(d.url).toBe(`https://github.com/Panth977/digital-canvas/releases/latest/download/${d.file}`);
  });
});
