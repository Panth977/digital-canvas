/** Shared plumbing for tool handlers: results, errors, page lookup. */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Doc, Page } from '@digital-canvas/scene';
import { ToolError } from '../context.ts';
import { findPage } from '../outline.ts';

export type Result = CallToolResult;

/** Compact JSON (no indentation: agents read it fine and it saves tokens). */
export const json = (v: unknown): Result => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });

export function errorResult(e: unknown): Result {
  const msg = e instanceof Error ? e.message : String(e);
  const hint = e instanceof ToolError && e.hint ? `\nHow to fix: ${e.hint}` : '';
  return { isError: true, content: [{ type: 'text', text: `Error: ${msg}${hint}` }] };
}

/** Run a handler; any throw becomes an error result the agent can read. */
export function safe<A>(fn: (args: A, extra: Extra) => Promise<Result>): (args: A, extra: Extra) => Promise<Result> {
  return async (args, extra) => {
    try {
      return await fn(args, extra);
    } catch (e) {
      return errorResult(e);
    }
  };
}

export interface Extra {
  signal?: AbortSignal;
  _meta?: { progressToken?: string | number };
  sendNotification?: (n: { method: 'notifications/progress'; params: { progressToken: string | number; progress: number; total?: number; message?: string } }) => Promise<void>;
}

/** A progress reporter for long tools (no-op when the client didn't ask). */
export function progress(extra: Extra): (p: number, message?: string) => void {
  const token = extra?._meta?.progressToken;
  if (token === undefined || !extra.sendNotification) return () => {};
  let last = -1;
  return (p, message) => {
    const v = Math.round(p * 100);
    if (v === last) return;
    last = v;
    void extra.sendNotification!({ method: 'notifications/progress', params: { progressToken: token, progress: v, total: 100, ...(message ? { message } : {}) } }).catch(() => {});
  };
}

export function pageOf(doc: Doc, ref: string | number | undefined): { page: Page; index: number } {
  const hit = findPage(doc, ref);
  if (!hit) throw new ToolError(`no page ${JSON.stringify(ref)} in this design (it has ${doc.pages.length})`, 'pass a page number (1 = first) or a page id from open_design');
  return hit;
}

export const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
