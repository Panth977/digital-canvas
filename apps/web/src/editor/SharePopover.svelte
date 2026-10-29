<script lang="ts">
  import { onMount } from 'svelte';
  import { qrCode } from '@digital-canvas/scene';
  import {
    SHARE_ROLES, inviteMessage, isEmail, isShared, linkAccessOf, mailtoLink, shareLink,
    type DriveStore, type LinkAccess, type Person, type ShareRole,
  } from '@digital-canvas/storage';
  import type { EditorState } from '../lib/editor.svelte.ts';
  import { account } from '../lib/account.svelte.ts';
  import { shareOrigin } from '../lib/sharing.ts';
  import { toast } from '../lib/toast.svelte.ts';
  import Icon from '../lib/Icon.svelte';

  /**
   * Canva's Share popover: people with access (add by email with a role, change, remove),
   * link access, Copy link, and quick actions (Download, Public view link, Present,
   * Template link, QR code, Email). Permissions are Drive permissions on the design file.
   */
  let { ed, onclose, ondownload, onpresent }: { ed: EditorState; onclose: () => void; ondownload: () => void; onpresent: () => void } = $props();

  const drive = $derived(ed.store.kind === 'drive' ? (ed.store as DriveStore) : null);
  let fileId = $state<string | null>(null);
  let people = $state<Person[]>([]);
  let loading = $state(true);
  let error = $state('');
  let busy = $state(''); // what is being changed right now
  let email = $state('');
  let role = $state<ShareRole>('writer');
  let message = $state('');
  let notify = $state(true);
  let view = $state<'main' | 'qr'>('main');
  /** Who was just added (the "send them the link" hint). */
  let sent = $state<string[]>([]);

  const link = $derived(linkAccessOf(people));
  const access = $derived(ed.access);
  const canShare = $derived(!!drive && (access ? access.canShare || access.ownedByMe : true));
  const owner = $derived(people.find((p) => p.role === 'owner'));
  const others = $derived(people.filter((p) => p.role !== 'owner' && p.type !== 'anyone'));
  const editLink = $derived(fileId ? shareLink('edit', fileId, shareOrigin()) : '');
  const viewLink = $derived(fileId ? shareLink('view', fileId, shareOrigin()) : '');
  const templateLink = $derived(fileId ? shareLink('template', fileId, shareOrigin()) : '');
  const me = $derived(account.user?.email?.toLowerCase());

  onMount(() => void load());

  async function load(): Promise<void> {
    if (!drive) { loading = false; return; }
    loading = true;
    error = '';
    try {
      fileId = (await drive.driveFileId(ed.doc.id)) ?? null;
      if (!fileId) {
        // a new design that was never saved yet
        await ed.save(true);
        fileId = (await drive.driveFileId(ed.doc.id)) ?? null;
      }
      if (!fileId) throw new Error('Save the design first.');
      const [list, a] = await Promise.all([drive.sharing.people(fileId).catch((e) => (ed.access && !ed.access.canShare ? [] : Promise.reject(e))), drive.access(ed.doc.id, true)]);
      people = list;
      if (a) ed.access = a;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  /**
   * After any change: tell the store whether the design is shared now. Shared:
   * write links.json (older saves lack it) and make its assets link-readable.
   */
  async function afterChange(): Promise<void> {
    if (!drive) return;
    const shared = isShared(people);
    drive.setShared(ed.doc.id, shared);
    if (!shared) return;
    busy = 'Making pictures and clips viewable…';
    try {
      if (!drive.hasLinks(ed.doc.id) || ed.saveState !== 'saved') await ed.save(true);
      await drive.publishAssets(ed.doc.id);
    } catch (e) {
      toast.show(`Couldn't share the pictures in this design: ${e instanceof Error ? e.message : e}`);
    } finally {
      busy = '';
    }
  }

  async function run(what: string, fn: () => Promise<void>): Promise<void> {
    busy = what;
    error = '';
    try {
      await fn();
      await afterChange();
    } catch (e) {
      error = e instanceof Error ? e.message.replace(/^Google Drive: /, '') : String(e);
    } finally {
      busy = '';
    }
  }

  function add(e: Event): void {
    e.preventDefault();
    const list = email.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    if (!fileId || !list.length) return;
    const bad = list.find((x) => !isEmail(x));
    if (bad) { error = `“${bad}” is not an email address.`; return; }
    void run('Sharing…', async () => {
      for (const addr of list) {
        // Drive's email links to drive.google.com: put the app link first
        const p = await drive!.sharing.add(fileId!, addr, role, { notify, message: inviteMessage(editLink, message) });
        people = [...people.filter((x) => x.id !== p.id), p];
      }
      toast.show(list.length === 1 ? `Shared with ${list[0]}` : `Shared with ${list.length} people`);
      sent = list;
      email = '';
      message = '';
    });
  }

  function changeRole(p: Person, next: string): void {
    if (!fileId) return;
    if (next === 'remove') {
      void run('Removing…', async () => {
        await drive!.sharing.remove(fileId!, p.id);
        people = people.filter((x) => x.id !== p.id);
      });
      return;
    }
    void run('Saving…', async () => {
      const q = await drive!.sharing.setRole(fileId!, p.id, next as ShareRole);
      people = people.map((x) => (x.id === p.id ? { ...x, role: q.role } : x));
    });
  }

  function setLink(next: LinkAccess): void {
    if (!fileId || next === link) return;
    void run('Saving…', async () => {
      await drive!.sharing.setLinkAccess(fileId!, next, people);
      people = await drive!.sharing.people(fileId!);
    });
  }

  async function copy(text: string, what = 'Link copied'): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      toast.show(what);
    } catch {
      toast.show(text);
    }
  }

  async function publicView(): Promise<void> {
    if (link === 'restricted') {
      const ok = await toast.ask({ title: 'Turn on the public view link?', body: 'Anyone with the link can see this design (without signing in). Its pictures and clips become viewable by link too.', ok: 'Anyone with the link can view' });
      if (!ok) return;
      setLink('reader');
    }
    await copy(viewLink, 'Public view link copied');
  }

  /** Phones: the system share sheet; elsewhere an email draft with the link. */
  async function sendLink(): Promise<void> {
    const text = `Open “${ed.doc.title}” in Digital Canvas`;
    if (navigator.share) {
      try { await navigator.share({ title: ed.doc.title, text, url: editLink }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
    }
    location.href = mailtoLink(ed.doc.title, editLink, account.user?.name).replace('mailto:?', `mailto:${encodeURIComponent(sent.join(','))}?`);
  }

  const initial = (p: { name?: string; email?: string }) => (p.name ?? p.email ?? '?').trim().charAt(0).toUpperCase();
  const roleLabel = (r: string) => SHARE_ROLES.find((x) => x.role === r)?.label ?? (r === 'owner' ? 'Owner' : r);
  const qr = $derived(view === 'qr' && editLink ? qrCode(link === 'restricted' ? editLink : viewLink, { x: 0, y: 0, w: 200, h: 200 }) : null);
  const ownerName = $derived(access?.owner?.name ?? owner?.name ?? owner?.email);
  const sharedBy = $derived(access && !access.ownedByMe ? access.sharedBy ?? access.owner : null);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="sh" data-testid="share-menu" onclick={(e) => e.stopPropagation()}>
  {#if view === 'qr'}
    <header><button class="btn ghost icon" aria-label="Back" onclick={() => (view = 'main')}><Icon name="left" size={18} /></button><h4>QR code</h4></header>
    {#if qr}
      <svg class="qr" viewBox="{qr.viewBox.x} {qr.viewBox.y} {qr.viewBox.w} {qr.viewBox.h}" data-testid="share-qr" data-text={qr.qr} shape-rendering="crispEdges" role="img" aria-label="QR code for the link">
        {#each qr.paths as p, i (i)}<path d={p.d} fill={p.fill?.type === 'solid' ? p.fill.color : '#000'} />{/each}
      </svg>
      <p class="note">Scan to open {link === 'restricted' ? 'the design (people added only)' : 'the public view'}.</p>
      <button class="btn" onclick={() => ed.addQr(qr.qr ?? '')} disabled={ed.readOnly} data-testid="share-qr-add"><Icon name="plus" size={16} /> Add to design</button>
    {/if}
  {:else}
    <header>
      <h4>Share this design</h4>
      <button class="btn ghost icon" aria-label="Close" onclick={onclose}><Icon name="close" size={18} /></button>
    </header>
    {#if !drive}
      <p class="note" data-testid="share-signin">Designs are shared from your Google Drive. Sign in with Google to add people or get a link.</p>
      <button class="btn primary" onclick={() => void account.signIn()} disabled={account.busy}>Sign in with Google</button>
    {:else if loading}
      <p class="note">Loading who has access…</p>
    {:else}
      {#if ownerName}
        <div class="owner" data-testid="share-owner">
          {#if sharedBy}Shared by <b>{sharedBy.name ?? sharedBy.email}</b>{access?.owner?.name && access.owner.name !== sharedBy.name ? ` · owner ${access.owner.name}` : ''}
          {:else}Owner: <b>{ownerName}</b>{access?.ownedByMe || (owner?.email && owner.email.toLowerCase() === me) ? ' (you)' : ''}{/if}
        </div>
      {/if}

      <h5>People with access</h5>
      {#if canShare && fileId}
        <form class="add" onsubmit={add}>
          <div class="row">
            <input class="input" type="text" inputmode="email" autocomplete="email" placeholder="Add people by email" bind:value={email} data-testid="share-email" aria-label="Email addresses" />
            <select class="input role" bind:value={role} data-testid="share-role" aria-label="Role">
              {#each SHARE_ROLES as r (r.role)}<option value={r.role}>{r.label}</option>{/each}
            </select>
          </div>
          {#if email.trim()}
            <textarea class="input" rows="2" placeholder="Message (optional)" bind:value={message} disabled={!notify} data-testid="share-message"></textarea>
            <label class="check"><input type="checkbox" bind:checked={notify} data-testid="share-notify" /> Notify people by email</label>
            {#if notify}
              <div class="preview" data-testid="share-email-preview"><small>Google's email will say</small><pre>{inviteMessage(editLink, message)}</pre></div>
            {/if}
            <button class="btn primary" disabled={!!busy} data-testid="share-send">{notify ? 'Send' : 'Share'}</button>
          {/if}
        </form>
      {/if}
      {#if sent.length}
        <div class="sent" data-testid="share-sent">
          <p><b>Shared with {sent.join(', ')}.</b> {notify ? 'Google emails them the link to open it in Digital Canvas.' : 'They were not emailed.'} You can also send it yourself:</p>
          <div class="row">
            <button class="btn" onclick={() => copy(editLink)} data-testid="share-sent-copy"><Icon name="link" size={16} /> Copy link</button>
            <button class="btn" onclick={() => void sendLink()} data-testid="share-sent-send"><Icon name="send" size={16} /> Send link</button>
            <button class="btn ghost icon" aria-label="Hide" onclick={() => (sent = [])}><Icon name="close" size={16} /></button>
          </div>
        </div>
      {/if}
      <ul class="people" data-testid="share-people">
        {#if owner}
          <li data-testid="share-person" data-email={owner.email}>
            <span class="av">{#if owner.photo}<img src={owner.photo} alt="" referrerpolicy="no-referrer" />{:else}{initial(owner)}{/if}</span>
            <span class="who"><b>{owner.name ?? owner.email}{owner.email?.toLowerCase() === me ? ' (you)' : ''}</b>{#if owner.name && owner.email}<small>{owner.email}</small>{/if}</span>
            <span class="r">Owner</span>
          </li>
        {/if}
        {#each others as p (p.id)}
          <li data-testid="share-person" data-email={p.email}>
            <span class="av">{#if p.photo}<img src={p.photo} alt="" referrerpolicy="no-referrer" />{:else}{initial(p)}{/if}</span>
            <span class="who"><b>{p.name ?? p.email ?? p.domain}{p.email?.toLowerCase() === me ? ' (you)' : ''}</b>{#if p.name && p.email}<small>{p.email}</small>{/if}</span>
            {#if canShare}
              <select class="input r" value={p.role} onchange={(e) => changeRole(p, (e.currentTarget as HTMLSelectElement).value)} disabled={!!busy} data-testid="share-person-role" aria-label="Role for {p.email ?? p.name}">
                {#each SHARE_ROLES as r (r.role)}<option value={r.role}>{r.label}</option>{/each}
                <option disabled>──────</option>
                <option value="remove">Remove access</option>
              </select>
            {:else}<span class="r">{roleLabel(p.role)}</span>{/if}
          </li>
        {/each}
      </ul>

      <h5>Link access</h5>
      <div class="linkrow">
        <span class="lic"><Icon name={link === 'restricted' ? 'lock' : 'globe'} size={18} /></span>
        <select class="input" value={link === 'restricted' ? 'restricted' : 'anyone'} disabled={!canShare || !!busy} data-testid="share-link-access" aria-label="Who can open the link"
          onchange={(e) => setLink((e.currentTarget as HTMLSelectElement).value === 'restricted' ? 'restricted' : 'reader')}>
          <option value="restricted">Only people added</option>
          <option value="anyone">Anyone with the link</option>
        </select>
        {#if link !== 'restricted'}
          <select class="input role" value={link} disabled={!canShare || !!busy} data-testid="share-link-role" aria-label="What anyone with the link can do"
            onchange={(e) => setLink((e.currentTarget as HTMLSelectElement).value as LinkAccess)}>
            <option value="reader">can view</option>
            <option value="commenter">can comment</option>
            <option value="writer">can edit</option>
          </select>
        {/if}
      </div>
      <p class="note">{link === 'restricted' ? 'Only people added above can open this design.' : 'Anyone on the internet with the link can open it.'}{isShared(people) ? ' Its pictures and clips can be opened by link too.' : ''}</p>

      {#if error}<p class="err" data-testid="share-error">{error}</p>{/if}
      {#if busy}<p class="note" data-testid="share-busy">{busy}</p>{/if}

      <button class="btn primary copy" disabled={!editLink} onclick={() => copy(editLink)} data-testid="share-copy" data-link={editLink}><Icon name="link" size={18} /> Copy link</button>
    {/if}

    <div class="quick" data-testid="share-quick">
      <button onclick={() => { onclose(); ondownload(); }} data-testid="share-download"><span><Icon name="download" size={20} /></span>Download</button>
      <button disabled={!viewLink || !canShare && link === 'restricted'} onclick={() => void publicView()} data-testid="share-public" data-link={viewLink}><span><Icon name="globe" size={20} /></span>Public view link</button>
      <button onclick={() => { onclose(); onpresent(); }} data-testid="share-present"><span><Icon name="play" size={20} /></span>Present</button>
      <button disabled={!templateLink} onclick={() => copy(templateLink, 'Template link copied: people who open it get their own copy')} data-testid="share-template" data-link={templateLink}><span><Icon name="templates" size={20} /></span>Template link</button>
      <button disabled={!editLink} onclick={() => (view = 'qr')} data-testid="share-qr-open"><span><Icon name="qr" size={20} /></span>QR code</button>
      <a class:off={!editLink} href={editLink ? mailtoLink(ed.doc.title, link === 'restricted' ? editLink : viewLink, account.user?.name) : undefined} data-testid="share-email-link"><span><Icon name="send" size={20} /></span>Email</a>
    </div>
  {/if}
</div>

<style>
  .sh { position: absolute; right: 0; top: 48px; width: 400px; max-height: calc(100vh - 80px); overflow-y: auto; background: var(--pop); color: var(--ink); border-radius: 12px; box-shadow: var(--shadow); padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 10px; z-index: 50; border: 1px solid var(--line); }
  header { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
  header:has(.icon:first-child) { justify-content: flex-start; margin-left: -6px; }
  h4 { margin: 0; font-size: 16px; }
  h5 { margin: 4px 0 -2px; font-size: 13px; font-weight: 600; color: var(--ink-2); }
  .owner { font-size: 13px; color: var(--ink-2); background: var(--chip); border-radius: 8px; padding: 8px 10px; }
  .add { display: flex; flex-direction: column; gap: 8px; }
  .row, .linkrow { display: flex; gap: 6px; align-items: center; }
  .row .input:first-child, .linkrow .input:first-of-type { flex: 1; min-width: 0; }
  .role { width: 128px; flex: none; }
  textarea { resize: vertical; font: inherit; }
  .check { display: flex; gap: 8px; align-items: center; font-size: 13px; cursor: pointer; }
  .people { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .people li { display: flex; align-items: center; gap: 10px; min-height: 40px; }
  .av { width: 32px; height: 32px; border-radius: 50%; background: var(--accent); color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 14px; overflow: hidden; flex: none; }
  .av img { width: 100%; height: 100%; object-fit: cover; }
  .who { flex: 1; min-width: 0; display: flex; flex-direction: column; font-size: 13px; }
  .who b, .who small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .who small { color: var(--muted); }
  .r { font-size: 13px; color: var(--muted); }
  select.r { width: 128px; flex: none; color: var(--ink); }
  .lic { width: 32px; height: 32px; border-radius: 50%; background: var(--chip); display: grid; place-items: center; flex: none; }
  .note { font-size: 12px; color: var(--muted); margin: 0; }
  .err { font-size: 12px; color: var(--danger); margin: 0; }
  .copy { height: 44px; font-size: 15px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
  .quick { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; border-top: 1px solid var(--line); padding-top: 12px; margin-top: 2px; }
  .quick button, .quick a { display: flex; flex-direction: column; align-items: center; gap: 6px; border: 0; background: transparent; color: var(--ink); font-size: 12px; padding: 6px 2px; border-radius: 10px; text-decoration: none; cursor: pointer; text-align: center; }
  .quick button:hover:not(:disabled), .quick a:hover { background: var(--hover); }
  .quick button:disabled, .quick a.off { opacity: .45; cursor: default; pointer-events: none; }
  .quick span { width: 44px; height: 44px; border-radius: 50%; background: var(--chip); display: grid; place-items: center; }
  .preview { background: var(--chip); border-radius: 8px; padding: 6px 10px; font-size: 12px; }
  .preview small { color: var(--muted); }
  .preview pre { margin: 2px 0 0; white-space: pre-wrap; word-break: break-all; font: 12px/1.4 inherit; font-family: inherit; }
  .sent { background: color-mix(in srgb, var(--accent) 10%, transparent); border-radius: 10px; padding: 10px; font-size: 13px; display: flex; flex-direction: column; gap: 8px; }
  .sent p { margin: 0; }
  .qr { width: 220px; height: 220px; align-self: center; background: #fff; border-radius: 8px; }
</style>
