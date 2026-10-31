/** The desktop app's release files. Names are fixed (apps/desktop/electron-builder.yml), so `latest/download/<name>` always works. */
export const RELEASES = 'https://github.com/Panth977/digital-canvas/releases/latest';
export const LATEST = 'https://api.github.com/repos/Panth977/digital-canvas/releases/latest';

export type Os = 'mac' | 'windows' | 'linux' | 'other';

export interface Download { id: string; os: Exclude<Os, 'other'>; arch?: 'arm64' | 'x64'; label: string; note: string; file: string; url: string }

const item = (id: string, os: Download['os'], arch: Download['arch'], label: string, note: string, file: string): Download =>
  ({ id, os, ...(arch ? { arch } : {}), label, note, file, url: `${RELEASES}/download/${file}` });

export const downloads = (): Download[] => [
  item('mac-arm64', 'mac', 'arm64', 'Mac, Apple silicon', 'M1 and newer (.dmg)', 'Digital-Canvas-mac-arm64.dmg'),
  item('mac-x64', 'mac', 'x64', 'Mac, Intel', 'Intel Macs (.dmg)', 'Digital-Canvas-mac-x64.dmg'),
  item('windows', 'windows', undefined, 'Windows', 'Windows 10 and 11, 64-bit (.exe)', 'Digital-Canvas-windows-x64.exe'),
  item('linux-appimage', 'linux', undefined, 'Linux AppImage', 'Most distributions', 'Digital-Canvas-linux-x86_64.AppImage'),
  item('linux-deb', 'linux', undefined, 'Linux .deb', 'Debian and Ubuntu', 'Digital-Canvas-linux-amd64.deb'),
];

export function detectOs(ua: string): Os {
  if (/Android|iPhone|iPad|CrOS/.test(ua)) return 'other';
  if (/Windows/.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac';
  if (/Linux|X11/.test(ua)) return 'linux';
  return 'other';
}
