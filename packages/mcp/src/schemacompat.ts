/**
 * Tool schemas every MCP client can read, Gemini's included: Gemini's
 * function declarations take an OpenAPI subset and refuse `$ref`, `$schema`,
 * `additionalProperties`, `exclusiveMinimum`, `const`, `not` and most string
 * formats. zod's JSON Schema uses them, so tools/list answers are rewritten:
 * refs are inlined and the rest is said in the supported words (or dropped
 * where it only tightened validation the server does anyway).
 */
type J = Record<string, unknown>;

const FORMATS = new Set(['date-time', 'enum']);

function resolve(root: J, ref: string): unknown {
  if (!ref.startsWith('#/')) return {};
  let cur: unknown = root;
  for (const part of ref.slice(2).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (!cur || typeof cur !== 'object') return {};
    cur = (cur as J)[part];
  }
  return cur ?? {};
}

export function compatSchema(schema: unknown, root: J = schema as J, depth = 0): unknown {
  if (Array.isArray(schema)) return schema.map((s) => compatSchema(s, root, depth));
  if (!schema || typeof schema !== 'object') return schema;
  let s = schema as J;
  if (typeof s.$ref === 'string') {
    if (depth > 12) return { type: 'object' };
    const { $ref, ...rest } = s;
    s = { ...(resolve(root, $ref as string) as J), ...rest };
    return compatSchema(s, root, depth + 1);
  }
  const out: J = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === '$schema' || k === 'additionalProperties' || k === 'not' || k === '$defs' || k === 'definitions') continue;
    if (k === 'exclusiveMinimum') { if (typeof v === 'number' && s.minimum === undefined) out.minimum = v; continue; }
    if (k === 'exclusiveMaximum') { if (typeof v === 'number' && s.maximum === undefined) out.maximum = v; continue; }
    if (k === 'const') { out.enum = [v]; continue; }
    if (k === 'format' && !FORMATS.has(String(v))) continue;
    if (k === 'properties' && v && typeof v === 'object') { out.properties = Object.fromEntries(Object.entries(v as J).map(([p, ps]) => [p, compatSchema(ps, root, depth)])); continue; }
    out[k] = typeof v === 'object' ? compatSchema(v, root, depth) : v;
  }
  // tuples (items: [a, b, c]) → one item schema
  if (Array.isArray(out.items)) {
    const list = out.items as J[];
    const types = [...new Set(list.map((x) => x.type))];
    out.items = types.length === 1 && list[0] ? list[0] : { type: 'number' };
  }
  // null: Gemini says `nullable` instead of a null type
  if (Array.isArray(out.type)) {
    const t = (out.type as string[]).filter((x) => x !== 'null');
    if (t.length < (out.type as string[]).length) out.nullable = true;
    out.type = t.length === 1 ? t[0] : t[0] ?? 'string';
  }
  if (Array.isArray(out.anyOf)) {
    const opts = (out.anyOf as J[]).filter((o) => o.type !== 'null');
    if (opts.length < (out.anyOf as J[]).length) out.nullable = true;
    if (opts.length === 1) { const { anyOf: _a, ...rest } = out; const merged = { ...opts[0], ...rest }; for (const k of Object.keys(out)) delete out[k]; Object.assign(out, merged); }
    else out.anyOf = opts;
  }
  if (Array.isArray(out.enum) && out.enum.some((v) => typeof v !== 'string')) {
    // Gemini enums are strings: describe other values instead
    out.description = `${out.description ? `${out.description} ` : ''}One of: ${(out.enum as unknown[]).map((v) => JSON.stringify(v)).join(', ')}.`;
    delete out.enum;
  }
  // an object with no properties listed still needs a type for Gemini
  if (!out.type && !out.anyOf && !out.enum && (out.properties || Object.keys(out).length === 0)) out.type = 'object';
  return out;
}

/** Rewrite tools/list answers of an McpServer's low-level server. */
export function compatToolList(server: { server: object }): void {
  const handlers = (server.server as { _requestHandlers?: Map<string, (req: unknown, extra: unknown) => Promise<unknown>> })._requestHandlers;
  const list = handlers?.get('tools/list');
  if (!handlers || !list) return;
  handlers.set('tools/list', async (req, extra) => {
    const r = (await list(req, extra)) as { tools: { inputSchema?: J; outputSchema?: J }[] };
    return { ...r, tools: r.tools.map((t) => ({ ...t, ...(t.inputSchema ? { inputSchema: compatSchema(t.inputSchema) as J } : {}), ...(t.outputSchema ? { outputSchema: compatSchema(t.outputSchema) as J } : {}) })) };
  });
}
