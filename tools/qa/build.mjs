#!/usr/bin/env node
/**
 * Writes the QA case document apps/web/public/qa/sharing.html (served at /qa/sharing.html)
 * from tools/qa/sharing-cases.mjs. With `--results <playwright.json> --out <file.html>`
 * it writes the run report instead: the same table with pass/fail from a Playwright
 * JSON reporter run (PLAYWRIGHT_JSON_OUTPUT_NAME=… npx playwright test --reporter=json).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AREAS, CASES } from './sharing-cases.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const resultsPath = opt('--results');
const out = opt('--out') ?? join(ROOT, 'apps/web/public/qa/sharing.html');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Full test title for a case-id reference (titles in qa-sharing.spec.ts start with the id). */
const sources = new Map();
function fullName(ref) {
  if (ref.name) return ref.name;
  if (!/^QA-\d+/.test(ref.test)) return ref.test;
  let src = sources.get(ref.file);
  if (!src) sources.set(ref.file, (src = readFileSync(join(ROOT, ref.file), 'utf8')));
  const m = new RegExp(`test\\((['\`])(${ref.test} [\\s\\S]*?)\\1, async`).exec(src);
  if (!m) throw new Error(`${ref.file}: no test titled "${ref.test} …"`);
  return m[2].replace(/\\(.)/g, '$1');
}

/** "file::title" → { status, ms } from Playwright's JSON report (all projects). */
function readResults(path) {
  const json = JSON.parse(readFileSync(path, 'utf8'));
  const map = new Map();
  const walk = (suite) => {
    for (const s of suite.suites ?? []) walk(s);
    for (const spec of suite.specs ?? []) {
      const key = `${basename(spec.file)}::${spec.title}`;
      const runs = spec.tests.flatMap((t) => t.results.map((r) => r.status));
      const skipped = spec.tests.every((t) => t.status === 'skipped');
      const status = skipped ? 'skipped' : spec.ok ? (runs.some((r) => r !== 'passed' && r !== 'skipped') ? 'flaky' : 'passed') : 'failed';
      const ms = spec.tests.reduce((n, t) => n + t.results.reduce((m, r) => m + (r.duration ?? 0), 0), 0);
      const prev = map.get(key);
      map.set(key, prev && prev.status === 'failed' ? prev : { status, ms });
    }
  };
  walk(json);
  return { map, stats: json.stats };
}

const results = resultsPath ? readResults(resultsPath) : null;

function statusOf(c) {
  if (c.live) return { cls: 'live', text: 'live (manual)' };
  const name = fullName(c.auto);
  if (!results) return { cls: 'auto', text: 'automated' };
  const r = results.map.get(`${basename(c.auto.file)}::${name}`);
  if (!r) return { cls: 'fail', text: 'not run' };
  return { cls: r.status === 'passed' || r.status === 'flaky' ? 'pass' : r.status === 'skipped' ? 'live' : 'fail', text: `${r.status} (${(r.ms / 1000).toFixed(1)} s)` };
}

const rows = AREAS.map(([area, label]) => {
  const list = CASES.filter((c) => c.area === area);
  if (!list.length) return '';
  return `<tr class="area"><th colspan="6">${esc(label)}</th></tr>\n` + list.map((c) => {
    const st = statusOf(c);
    const test = c.live ? '<span class="muted">Real Google accounts (Panth = owner, Harshil = recipient)</span>' : `<code>${esc(c.auto.file)}</code><br>${esc(fullName(c.auto))}`;
    return `<tr id="${c.id}" data-status="${st.cls}"><td class="id">${c.id}</td><td><b>${esc(c.title)}</b></td><td><ol>${c.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></td><td>${esc(c.expected)}</td><td class="test">${test}</td><td><span class="st ${st.cls}">${esc(st.text)}</span></td></tr>`;
  }).join('\n');
}).join('\n');

const count = (cls) => CASES.filter((c) => statusOf(c).cls === cls).length;
const summary = results
  ? `<p class="sum"><span class="st pass">${count('pass')} passed</span> <span class="st fail">${count('fail')} failed / not run</span> <span class="st live">${count('live')} live</span> · whole suite: ${results.stats.expected} passed, ${results.stats.unexpected} failed, ${results.stats.flaky} flaky, ${results.stats.skipped} skipped · run ${esc(results.stats.startTime)} (${(results.stats.duration / 1000).toFixed(0)} s)</p>`
  : `<p class="sum"><span class="st auto">${count('auto')} automated</span> <span class="st live">${count('live')} live</span> · Automated cases run with <code>npx playwright test</code> against an in-memory Google Drive that models two users (owner and recipient: separate tokens, per-file permissions, 404 for files drive.file has not granted) and a stand-in Google Picker (<code>e2e/fake-drive.ts</code>, <code>e2e/fake-picker.ts</code>). Live cases need real Google accounts.</p>`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Digital Canvas · QA: sharing and import${results ? ' · results' : ''}</title>
<style>
  :root { color-scheme: light dark; --ink: #18191b; --muted: #6b6f76; --line: #e3e4e8; --bg: #fff; --head: #f4f2fb; --accent: #7d2ae8; }
  @media (prefers-color-scheme: dark) { :root { --ink: #ecedee; --muted: #9ba1a6; --line: #313538; --bg: #151718; --head: #22202b; } }
  body { margin: 0; font: 14px/1.45 system-ui, -apple-system, Segoe UI, sans-serif; color: var(--ink); background: var(--bg); }
  main { max-width: 1400px; margin: 0 auto; padding: 24px 20px 60px; }
  h1 { font-size: 24px; margin: 0 0 4px; } h1 small { color: var(--accent); font-size: 14px; font-weight: 600; margin-left: 6px; }
  .muted { color: var(--muted); }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid var(--line); }
  thead th { position: sticky; top: 0; background: var(--bg); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  tr.area th { background: var(--head); font-size: 15px; padding-top: 14px; }
  td.id { font-weight: 700; white-space: nowrap; }
  td.test { font-size: 12px; max-width: 320px; } td.test code { font-size: 11px; color: var(--muted); }
  ol { margin: 0; padding-left: 18px; }
  .st { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .pass { background: #d3f9d8; color: #1b6e2b; } .fail { background: #ffe3e3; color: #a61e1e; }
  .live { background: #fff3bf; color: #7a5a00; } .auto { background: #e5dbff; color: #4c1d95; }
  .sum { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .note { background: var(--head); border-radius: 10px; padding: 10px 14px; margin-top: 12px; }
</style></head>
<body><main>
<h1>QA: sharing, opening shared designs, import${results ? '<small>run results</small>' : ''}</h1>
<p class="muted">Digital Canvas (ORCH-27, round r12). Generated by <code>node tools/qa/build.mjs</code> from <code>tools/qa/sharing-cases.mjs</code>${results ? ` and ${esc(basename(resultsPath))}` : ''}. Do not edit by hand.</p>
${summary}
<div class="note"><b>Before the live cases:</b> the API key used to read pictures of shared designs (<code>DRIVE_API_KEY</code> = the Picker key) must allow the <b>Google Drive API</b> (Cloud console › Credentials › API restrictions). Until then a recipient sees blank placeholders where the owner’s pictures are (QA-43). Drive “Open with” needs the new <code>drive.install</code> scope: new sign-ins ask for it; existing accounts get a one-time “Show in Drive” banner (QA-21, QA-47).</div>
<table>
<thead><tr><th>ID</th><th>Case</th><th>Steps</th><th>Expected</th><th>Covered by</th><th>Status</th></tr></thead>
<tbody>
${rows}
</tbody></table>
</main></body></html>
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`wrote ${out} (${CASES.length} cases)`);
