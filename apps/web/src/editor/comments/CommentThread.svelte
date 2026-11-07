<script lang="ts">
  import type { DesignComment, CommentAuthor } from '@digital-canvas/scene';
  import { formatTime, pageStart } from '@digital-canvas/scene';
  import Icon from '../../lib/Icon.svelte';
  import { ago, type CommentsState } from '../../lib/comments.svelte.ts';
  import { toast } from '../../lib/toast.svelte.ts';

  /**
   * One comment thread as a card (Canva/Figma): the comment, its replies, a
   * reply box, Resolve and Delete. Without `comment` it is the new-comment
   * card for `cs.draft`.
   */
  let { cs, comment = null, n = 0, compact = false, onclose }: {
    cs: CommentsState;
    comment?: DesignComment | null;
    n?: number;
    /** In the panel list: no close button. */
    compact?: boolean;
    onclose?: () => void;
  } = $props();

  let text = $state('');
  let editing = $state<{ id: string; reply?: string; text: string } | null>(null);
  let timed = $state(true);
  let box = $state<HTMLTextAreaElement>();

  $effect(() => { if (!compact) box?.focus(); });

  const draftTime = $derived.by(() => {
    const a = cs.draft?.anchor;
    if (!a || a.t == null) return null;
    return formatTime(pageStart(cs.ed.doc, a.page) + a.t);
  });

  function initials(a: CommentAuthor): string {
    return a.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
  }

  async function send(): Promise<void> {
    const t = text;
    if (!t.trim() || cs.busy) return;
    const ok = comment ? await cs.reply(comment.id, t) : await cs.submit(t, timed);
    if (ok) text = '';
  }

  function key(e: KeyboardEvent, submit: () => void): void {
    e.stopPropagation(); // editor shortcuts stay out of the text box
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    else if (e.key === 'Escape') { e.preventDefault(); if (editing) editing = null; else onclose?.(); }
  }

  async function saveEdit(): Promise<void> {
    if (!editing || !comment) return;
    if (await cs.edit(comment.id, editing.text, editing.reply)) editing = null;
  }

  async function del(replyId?: string): Promise<void> {
    if (!comment) return;
    const ok = await toast.ask({ title: replyId ? 'Delete this reply?' : 'Delete this comment?', body: replyId ? undefined : 'The whole thread goes, with its replies.', ok: 'Delete', danger: true });
    if (ok) await cs.remove(comment.id, replyId);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="thread" class:compact class:resolved={comment?.resolved} data-testid={comment ? 'comment-thread' : 'comment-draft'} data-id={comment?.id}
  onpointerdown={(e) => e.stopPropagation()} onwheel={(e) => e.stopPropagation()}>
  {#if comment}
    <div class="head">
      <span class="num" title="Comment {n}">{n}</span>
      <span class="where">{cs.where(comment)}</span>
      {#if cs.unsynced.has(comment.id)}<span class="sync" data-testid="comment-sending">Sending…</span>{/if}
      <span class="grow"></span>
      {#if cs.canComment}
        <button class="ib" title={comment.resolved ? 'Reopen' : 'Resolve'} aria-label={comment.resolved ? 'Reopen' : 'Resolve'} disabled={cs.busy}
          onclick={(e) => { e.stopPropagation(); void cs.resolve(comment!.id, !comment!.resolved); }} data-testid="comment-resolve">
          <Icon name={comment.resolved ? 'reopen' : 'check'} size={18} />
        </button>
      {/if}
      {#if comment.author.me}
        <button class="ib" title="Delete thread" aria-label="Delete thread" disabled={cs.busy} onclick={(e) => { e.stopPropagation(); void del(); }} data-testid="comment-delete"><Icon name="trash" size={17} /></button>
      {/if}
      {#if !compact}<button class="ib" title="Close" aria-label="Close" onclick={() => onclose?.()} data-testid="comment-close"><Icon name="close" size={17} /></button>{/if}
    </div>
    {#each [{ id: '', author: comment.author, text: comment.text, createdAt: comment.createdAt, action: undefined as 'resolve' | 'reopen' | undefined }, ...comment.replies] as m, i (m.id || 'root')}
      <div class="msg" class:sys={!!m.action && !m.text} data-testid={i ? 'comment-reply' : 'comment-body'}>
        {#if m.action && !m.text}
          <p class="action"><Icon name={m.action === 'resolve' ? 'check' : 'reopen'} size={14} /> {m.author.name} {m.action === 'resolve' ? 'resolved' : 'reopened'} this · {ago(m.createdAt)}</p>
        {:else}
          <div class="who">
            {#if m.author.photo}<img class="av" src={m.author.photo} alt="" referrerpolicy="no-referrer" />{:else}<span class="av">{initials(m.author)}</span>{/if}
            <b>{m.author.name}</b><span class="when">{cs.unsynced.has(m.id) ? 'Sending…' : ago(m.createdAt)}</span>
            {#if m.action}<span class="tag">{m.action === 'resolve' ? 'Resolved' : 'Reopened'}</span>{/if}
            <span class="grow"></span>
            {#if m.author.me && !compact && editing?.id !== (m.id || 'root')}
              <button class="ib sm" title="Edit" aria-label="Edit" onclick={() => (editing = { id: m.id || 'root', reply: m.id || undefined, text: m.text })} data-testid="comment-edit"><Icon name="pen" size={14} /></button>
              {#if i}<button class="ib sm" title="Delete reply" aria-label="Delete reply" onclick={() => void del(m.id)}><Icon name="trash" size={14} /></button>{/if}
            {/if}
          </div>
          {#if editing && editing.id === (m.id || 'root')}
            <textarea class="field" rows="2" bind:value={editing.text} onkeydown={(e) => key(e, () => void saveEdit())} data-testid="comment-edit-box"></textarea>
            <div class="row"><button class="btn ghost" onclick={() => (editing = null)}>Cancel</button><button class="btn" disabled={!editing.text.trim() || cs.busy} onclick={() => void saveEdit()} data-testid="comment-edit-save">Save</button></div>
          {:else}
            <p class="text">{m.text}</p>
          {/if}
        {/if}
      </div>
    {/each}
    {#if cs.canComment && !compact}
      <div class="compose">
        <textarea class="field" rows="1" placeholder="Reply" bind:this={box} bind:value={text} onkeydown={(e) => key(e, () => void send())} data-testid="comment-reply-box"></textarea>
        <button class="send" title="Send" aria-label="Send reply" disabled={!text.trim() || cs.busy} onclick={() => void send()} data-testid="comment-reply-send"><Icon name="send" size={16} /></button>
      </div>
    {/if}
  {:else}
    <div class="head"><span class="where">New comment</span><span class="grow"></span><button class="ib" title="Cancel" aria-label="Cancel" onclick={() => onclose?.()}><Icon name="close" size={17} /></button></div>
    <textarea class="field big" rows="3" placeholder="Add a comment" bind:this={box} bind:value={text} onkeydown={(e) => key(e, () => void send())} data-testid="comment-box"></textarea>
    {#if draftTime}
      <label class="timed"><input type="checkbox" bind:checked={timed} data-testid="comment-timed" /> At {draftTime}</label>
    {/if}
    <div class="row"><button class="btn ghost" onclick={() => onclose?.()}>Cancel</button><button class="btn" disabled={!text.trim() || cs.busy} onclick={() => void send()} data-testid="comment-submit">Comment</button></div>
  {/if}
</div>

<style>
  .thread { width: 300px; max-height: min(460px, 70vh); overflow: auto; background: var(--pop); color: var(--ink); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); padding: 10px 12px; font-size: 13px; cursor: default; }
  .thread.compact { width: auto; max-height: none; box-shadow: none; }
  .thread.resolved { opacity: .85; }
  .head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
  .num { min-width: 20px; height: 20px; padding: 0 5px; border-radius: 10px 10px 10px 2px; background: var(--accent); color: #fff; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
  .resolved .num { background: var(--muted); }
  .where { color: var(--muted); font-size: 12px; font-weight: 600; }
  .grow { flex: 1; }
  .ib { width: 28px; height: 28px; border: 0; border-radius: 8px; background: transparent; color: var(--ink-2); display: inline-flex; align-items: center; justify-content: center; }
  .ib.sm { width: 22px; height: 22px; }
  .ib:hover:not(:disabled) { background: var(--hover); color: var(--ink); }
  .msg { padding: 6px 0; border-top: 1px solid var(--line); }
  .head + .msg { border-top: 0; }
  .who { display: flex; align-items: center; gap: 6px; }
  .av { width: 22px; height: 22px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); font-size: 10px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; object-fit: cover; flex-shrink: 0; }
  .when { color: var(--muted); font-size: 11px; }
  .sync { color: var(--muted); font-size: 11px; font-style: italic; }
  .tag { font-size: 11px; color: var(--ok); font-weight: 600; }
  .text { margin: 4px 0 0 28px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.4; }
  .action { margin: 0; color: var(--muted); font-size: 12px; display: flex; align-items: center; gap: 4px; }
  .field { width: 100%; box-sizing: border-box; resize: vertical; border: 1px solid var(--line); border-radius: 8px; background: var(--field); color: var(--ink); padding: 7px 9px; font: inherit; font-size: 13px; }
  .field:focus { outline: none; border-color: var(--accent); }
  .field.big { min-height: 64px; }
  .compose { display: flex; gap: 6px; align-items: flex-end; margin-top: 6px; }
  .send { width: 34px; height: 34px; flex-shrink: 0; border: 0; border-radius: 8px; background: var(--accent); color: #fff; display: inline-flex; align-items: center; justify-content: center; }
  .send:disabled { opacity: .4; }
  .row { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
  .btn { height: 32px; padding: 0 14px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font-weight: 600; font-size: 13px; }
  .btn:disabled { opacity: .45; }
  .btn.ghost { background: var(--chip); color: var(--ink); }
  .timed { display: flex; align-items: center; gap: 6px; margin-top: 6px; color: var(--ink-2); font-size: 12px; }
</style>
