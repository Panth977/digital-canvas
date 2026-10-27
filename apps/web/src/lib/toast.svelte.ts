/**
 * Canva-style toasts (bottom-left, one line, optional action such as "Undo")
 * and confirmation dialogs (instead of the browser's confirm()).
 */

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
  /** ms; 0 keeps it until closed. */
  timeout: number;
}

export interface Confirm {
  title: string;
  body?: string;
  ok: string;
  cancel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

class Toaster {
  list = $state<Toast[]>([]);
  confirm = $state.raw<Confirm | null>(null);
  private next = 1;
  private timers = new Map<number, ReturnType<typeof setTimeout>>();

  show(text: string, opts: { action?: Toast['action']; timeout?: number } = {}): number {
    const id = this.next++;
    const t: Toast = { id, text, action: opts.action, timeout: opts.timeout ?? (opts.action ? 6000 : 4000) };
    // Canva shows at most a few; the newest replaces the oldest.
    this.list = [...this.list.slice(-2), t];
    if (t.timeout) this.timers.set(id, setTimeout(() => this.close(id), t.timeout));
    return id;
  }

  close(id: number): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.list = this.list.filter((t) => t.id !== id);
  }

  /** Ask before something that can't be undone. Resolves true on OK. */
  ask(opts: { title: string; body?: string; ok?: string; cancel?: string; danger?: boolean }): Promise<boolean> {
    this.confirm?.resolve(false);
    return new Promise((resolve) => {
      this.confirm = {
        title: opts.title, body: opts.body, ok: opts.ok ?? 'OK', cancel: opts.cancel ?? 'Cancel', danger: opts.danger ?? false,
        resolve: (ok) => { this.confirm = null; resolve(ok); },
      };
    });
  }
}

export const toast = new Toaster();
