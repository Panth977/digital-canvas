import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { harness, type Harness } from './helpers.ts';

let h: Harness;
beforeAll(async () => { h = await harness(); });
afterAll(async () => { await h.close(); });

/** Gemini function declarations: OpenAPI subset, no refs, string enums, typed nodes, `nullable` for null. */
describe('tool schemas are Gemini-safe', () => {
  it('every tool', async () => {
    const t = await h.client.listTools();
    const issues: string[] = [];
    const ok = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object']);
    const banned = ['$ref', '$schema', 'additionalProperties', 'exclusiveMinimum', 'exclusiveMaximum', 'const', 'not', '$defs', 'oneOf', 'allOf'];
    const walk = (s: any, path: string) => {
      if (!s || typeof s !== 'object') return;
      for (const b of banned) if (b in s) issues.push(`${path}: ${b}`);
      if (s.type !== undefined && (typeof s.type !== 'string' || !ok.has(s.type))) issues.push(`${path}: type ${JSON.stringify(s.type)}`);
      if (s.type === undefined && !s.anyOf) issues.push(`${path}: no type`);
      if (s.enum && s.enum.some((v: unknown) => typeof v !== 'string')) issues.push(`${path}: enum`);
      if (s.type === 'array' && (!s.items || Array.isArray(s.items))) issues.push(`${path}: items`);
      if (s.properties) for (const [k, v] of Object.entries(s.properties)) walk(v, `${path}.${k}`);
      if (s.items) walk(s.items, `${path}.items`);
      if (s.anyOf) s.anyOf.forEach((x: any, i: number) => walk(x, `${path}.anyOf${i}`));
    };
    for (const tool of t.tools) walk(tool.inputSchema, tool.name);
    expect(issues).toEqual([]);
  });
});
