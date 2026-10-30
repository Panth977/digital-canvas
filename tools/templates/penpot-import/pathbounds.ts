/** Bounds of an absolute SVG path (control points included), in file coordinates. */
export function parsePathBounds(d: string): { x: number; y: number; w: number; h: number } | null {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/gi);
  if (!tokens) return null;
  let cmd = '', i = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const num = () => Number(tokens[i++]);
  const pt = (x: number, y: number) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); };
  const COUNT: Record<string, number> = { M: 2, L: 2, C: 6, Q: 4, S: 4, T: 2, H: 1, V: 1, A: 7 };
  let last = { x: 0, y: 0 };
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i]!)) cmd = tokens[i++]!;
    if (/^[Zz]$/.test(cmd)) continue;
    if (cmd !== cmd.toUpperCase()) return null; // relative commands: the caller falls back to the shape's box
    const n = COUNT[cmd];
    if (!n || i + n > tokens.length) return null;
    const v = Array.from({ length: n }, num);
    if (cmd === 'H') last = { x: v[0]!, y: last.y };
    else if (cmd === 'V') last = { x: last.x, y: v[0]! };
    else if (cmd === 'A') last = { x: v[5]!, y: v[6]! };
    else {
      for (let k = 0; k < n; k += 2) pt(v[k]!, v[k + 1]!);
      last = { x: v[n - 2]!, y: v[n - 1]! };
    }
    pt(last.x, last.y);
  }
  return minX === Infinity ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
