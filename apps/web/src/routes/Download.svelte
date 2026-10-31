<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../lib/Icon.svelte';
  import { router } from '../lib/router.svelte.ts';
  import { LATEST, RELEASES, detectOs, downloads, type Os } from '../lib/downloads.ts';

  let os = $state<Os>(detectOs(navigator.userAgent));
  let arch = $state<'arm64' | 'x64' | null>(null);
  let version = $state('');

  onMount(() => {
    const ua = (navigator as unknown as { userAgentData?: { getHighEntropyValues(k: string[]): Promise<{ architecture?: string }> } }).userAgentData;
    void ua?.getHighEntropyValues(['architecture']).then((v) => { arch = v.architecture === 'arm' ? 'arm64' : v.architecture === 'x86' ? 'x64' : null; }).catch(() => {});
    void fetch(LATEST).then((r) => (r.ok ? r.json() : null)).then((j: { tag_name?: string } | null) => { version = j?.tag_name?.replace(/^v/, '') ?? ''; }).catch(() => {});
  });

  const all = downloads();
  const primary = $derived(all.filter((d) => d.os === os && (!arch || !d.arch || d.arch === arch)));
</script>

<div class="page scroll-y" data-testid="download-page">
  <header>
    <button class="brand" onclick={() => router.go({ name: 'home' })}><img src="/favicon.svg" alt="" width="28" height="28" /> Digital Canvas</button>
  </header>
  <main>
    <h1>Digital Canvas on your computer</h1>
    <p class="lead">No account and no server. It runs on your machine, keeps designs in a folder you choose, works offline, and gives your local AI tools an MCP address.</p>
    <div class="cta">
      {#each primary as d (d.file)}
        <a class="btn primary big" href={d.url} data-testid="download-primary"><Icon name="download" size={18} /> {d.label}</a>
      {:else}
        <p>Desktop downloads are for Mac, Windows and Linux. Pick one below.</p>
      {/each}
    </div>
    <p class="muted">{version ? `Version ${version}. ` : ''}<a href={RELEASES}>All releases on GitHub</a></p>

    <h2>All downloads</h2>
    <ul class="list">
      {#each all as d (d.file)}<li><a href={d.url} data-testid="download-{d.id}">{d.label}</a><span>{d.note}</span></li>{/each}
    </ul>

    <h2>First launch</h2>
    <p>The app isn’t code-signed yet, so your system will ask before the first start.</p>
    <h3>Mac</h3>
    <p>Open the <code>.dmg</code>, drag Digital Canvas to Applications, and open it. When macOS refuses, go to <b>System Settings › Privacy &amp; Security</b>, scroll down and choose <b>Open Anyway</b>. If it says the app is damaged, run this in Terminal:</p>
    <pre>xattr -dr com.apple.quarantine "/Applications/Digital Canvas.app"</pre>
    <h3>Windows</h3>
    <p>When SmartScreen shows “Windows protected your PC”, choose <b>More info</b>, then <b>Run anyway</b>.</p>
    <h3>Linux</h3>
    <p>AppImage: <code>chmod +x Digital-Canvas-linux-x86_64.AppImage</code>, then run it. Debian or Ubuntu: <code>sudo apt install ./Digital-Canvas-linux-amd64.deb</code>.</p>
    <p class="muted">The app checks GitHub for new versions and tells you; it never installs anything by itself.</p>
  </main>
</div>

<style>
  .page { height: 100%; }
  header { padding: 14px 24px; border-bottom: 1px solid var(--line); }
  .brand { display: flex; align-items: center; gap: 10px; background: none; border: 0; font: 700 17px/1 inherit; color: var(--ink); cursor: pointer; padding: 0; }
  main { max-width: 720px; margin: 0 auto; padding: 32px 24px 64px; line-height: 1.55; }
  h1 { font-size: 34px; line-height: 1.15; margin: 0 0 12px; }
  h2 { margin: 36px 0 8px; font-size: 20px; }
  h3 { margin: 18px 0 4px; font-size: 15px; }
  .lead { font-size: 17px; color: var(--ink-2); margin: 0 0 20px; }
  .cta { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; }
  .big { padding: 11px 18px; font-size: 15px; text-decoration: none; }
  .muted { color: var(--muted); font-size: 14px; }
  .list { list-style: none; padding: 0; margin: 0; }
  .list li { display: flex; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px solid var(--line); }
  .list span { color: var(--muted); font-size: 14px; text-align: right; }
  a { color: var(--accent); }
  a.btn { color: #fff; }
  pre { background: var(--chip); padding: 10px 12px; border-radius: 8px; overflow: auto; font: 13px ui-monospace, Menlo, monospace; }
  code { font: 13px ui-monospace, Menlo, monospace; background: var(--chip); padding: 1px 5px; border-radius: 5px; }
</style>
