<script lang="ts">
  import { untrack } from 'svelte';
  import { readAccess, type DriveStore, type FileAccess } from '@digital-canvas/storage';
  import Icon from '../lib/Icon.svelte';
  import { account } from '../lib/account.svelte.ts';
  import { library } from '../lib/library.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { pickSharedFile } from '../lib/picker.ts';
  import { copyInto, needsGrant } from '../lib/shared.svelte.ts';
  import { driveApiKey } from '../lib/sharing.ts';

  /**
   * A share link: `/d/<fileId>` opens the design shared with you in the editor,
   * `/template/<fileId>` makes your own copy and opens that. Needs sign-in.
   * The first time, drive.file hasn't granted the app this file: "Shared with
   * you: Open" shows the Google Picker with just this file, which grants it.
   */
  let { fileId, template = false }: { fileId: string; template?: boolean } = $props();

  type Phase = 'signin' | 'checking' | 'grant' | 'opening' | 'error';
  let phase = $state<Phase>('checking');
  let error = $state('');
  /** Title / owner when the link is public (API key), for the card. */
  let info = $state<FileAccess | null>(null);
  let started = false;

  const drive = () => (library.store.kind === 'drive' ? (library.store as DriveStore) : null);

  // what we can say before signing in (link-shared designs only)
  void readAccess(untrack(() => fileId), { apiKey: driveApiKey() }).then((a) => (info = a)).catch(() => {});

  $effect(() => {
    if (!account.known || !library.ready) return;
    if (!account.user) { phase = 'signin'; started = false; return; }
    if (drive() && !started) { started = true; untrack(() => void check()); }
  });

  async function check(): Promise<void> {
    const d = drive()!;
    phase = 'checking';
    try {
      // Editing needs real (OAuth) access; a template copy only needs to read it (the key will do).
      if (!template) info = await d.sharing.access(fileId);
      await open();
    } catch (e) {
      if (needsGrant(e)) phase = 'grant';
      else fail(e);
    }
  }

  async function grant(): Promise<void> {
    try {
      const ok = await pickSharedFile(await account.driveToken(), fileId);
      if (!ok) return;
      phase = 'checking';
      info = await drive()!.sharing.access(fileId).catch(() => info);
      await open();
    } catch (e) {
      if (needsGrant(e)) { phase = 'grant'; error = 'Google Drive still says no: pick the design in the window that opens. If it is not there, ask the owner to share it with your Google account.'; }
      else fail(e);
    }
  }

  async function open(): Promise<void> {
    const d = drive()!;
    phase = 'opening';
    const file = await d.openFile(fileId);
    if (template) {
      const doc = await copyInto(d, file, file.doc.title);
      router.go({ name: 'editor', id: doc.id });
    } else router.go({ name: 'editor', id: file.doc.id });
  }

  function fail(e: unknown): void {
    phase = 'error';
    error = e instanceof Error ? e.message.replace(/^Google Drive: /, '') : String(e);
  }

  const title = $derived(info?.name?.replace(/\.dcanvas$/, '') ?? 'A design');
  const from = $derived(info?.sharedBy?.name ?? info?.owner?.name ?? info?.owner?.email);
</script>

<div class="wrap">
  <div class="card" data-testid="shared-open" data-phase={phase}>
    <div class="logo"><Icon name={template ? 'templates' : 'user'} size={26} /></div>
    <h2>{template ? 'Use this template' : 'Shared with you'}</h2>
    <p class="what"><b>{title}</b>{#if from}<br /><span>from {from}</span>{/if}</p>
    {#if phase === 'signin'}
      <p>{template ? 'Sign in with Google to get your own copy in your Drive.' : 'Sign in with Google to open it.'}</p>
      <button class="btn primary" disabled={account.busy} onclick={() => void account.signIn()} data-testid="shared-signin">Sign in with Google</button>
      {#if !template}<button class="btn ghost" onclick={() => router.go({ name: 'view', fileId })}>View without signing in</button>{/if}
    {:else if phase === 'grant'}
      <p>Google Drive asks you to confirm the file once, so Digital Canvas can open it.</p>
      <button class="btn primary" onclick={() => void grant()} data-testid="shared-grant"><Icon name="drive" size={18} /> Open</button>
      {#if error}<p class="err">{error}</p>{/if}
    {:else if phase === 'error'}
      <p class="err" data-testid="shared-error">{error}</p>
      <button class="btn" onclick={() => router.go({ name: 'home' })}>Your designs</button>
    {:else}
      <div class="spinner"></div>
      <p>{phase === 'opening' ? (template ? 'Copying into your Drive…' : 'Opening…') : 'Checking access…'}</p>
    {/if}
  </div>
</div>

<style>
  .wrap { height: 100%; display: grid; place-items: center; background: var(--stage); padding: 16px; }
  .card { width: min(420px, 100%); background: var(--pop); color: var(--ink); border-radius: 16px; box-shadow: var(--shadow); padding: 28px; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; }
  .logo { width: 56px; height: 56px; border-radius: 50%; background: var(--header); color: #fff; display: grid; place-items: center; }
  h2 { margin: 0; font-size: 20px; }
  p { margin: 0; color: var(--ink-2); font-size: 14px; }
  .what span { color: var(--muted); font-size: 13px; }
  .err { color: var(--danger); }
  .btn { min-width: 200px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
  .spinner { width: 28px; height: 28px; border-radius: 50%; border: 3px solid var(--line); border-top-color: var(--accent); animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
