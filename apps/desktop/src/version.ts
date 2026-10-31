/** True when `tag` (a release tag, with or without "v") is newer than `current`. */
export function isNewer(tag: string, current: string): boolean {
  const parts = (v: string) => v.replace(/^v/, '').split('-')[0]!.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const a = parts(tag), b = parts(current);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
}
