/**
 * The desktop app (apps/desktop) from the page's side. The preload script puts
 * `window.dcDesktop` there; everywhere else this is all dormant.
 */
export interface McpClientConfig { id: string; label: string; hint: string; text: string }
export interface DesktopDriveAccount { uid: string; email: string; name: string; photo?: string }
export interface DesktopState {
  version: string;
  platform: string;
  port: number;
  folder: string | null;
  defaultFolder: string;
  active: 'folder' | 'drive';
  drive: { configured: boolean; connected: boolean; connecting: boolean; persisted: boolean; account: DesktopDriveAccount | null };
  mcp: { enabled: boolean; url: string; fallbackUrl: string; token: string; configs: McpClientConfig[] };
  update: { version: string; url: string } | null;
}

interface Bridge {
  initial: DesktopState | null;
  call(op: string, args?: unknown): Promise<unknown>;
  on(event: 'state' | 'changed' | 'request', cb: (data: never) => void): () => void;
}

const bridge = (): Bridge | undefined => (typeof window === 'undefined' ? undefined : (window as unknown as { dcDesktop?: Bridge }).dcDesktop);

export const isDesktop = (): boolean => !!bridge();

class Desktop {
  state = $state<DesktopState | null>(bridge()?.initial ?? null);
  /** The Settings dialog is open. */
  settingsOpen = $state(false);

  constructor() {
    const b = bridge();
    if (!b) return;
    b.on('state', (s: DesktopState) => { this.state = s; });
    b.on('request', (r: { id: number; op: string; args: never }) => void this.answer(r));
  }

  call<T = unknown>(op: string, args?: unknown): Promise<T> {
    return bridge()!.call(op, args) as Promise<T>;
  }

  /** The Drive account, while Drive is the active store. */
  get driveAccount(): DesktopDriveAccount | null {
    const s = this.state;
    return s?.active === 'drive' ? s.drive.account : null;
  }

  onFolderChanged(cb: () => void): () => void {
    return bridge()!.on('changed', cb);
  }

  connectDrive(): Promise<void> { return this.call('drive.connect', {}); }
  disconnectDrive(): Promise<void> { return this.call('drive.disconnect'); }
  driveToken(force?: boolean): Promise<string> { return this.call('drive.token', { force }); }
  pick(mode: 'media' | 'design' | 'file', arg?: string): Promise<unknown> { return this.call('drive.pick', { mode, arg }); }
  setActive(active: 'folder' | 'drive'): Promise<void> { return this.call('setActive', { active }); }

  /** The main process needs the window's WebCodecs (MCP video) or speech model. */
  private async answer(r: { id: number; op: string; args: never }): Promise<void> {
    try {
      if (r.op === 'speech.say') {
        const a = r.args as { text: string; voice: string; speed: number };
        const { speakOnDevice } = await import('../tts/synth.ts');
        const { pcm, rate } = await speakOnDevice(a.text, { voice: a.voice, speed: a.speed, engine: 'gpu' });
        await this.call('respond', { id: r.id, ok: true, value: { pcm, rate } });
        return;
      }
      const { videoTask } = await import('./video.ts');
      await this.call('respond', { id: r.id, ok: true, value: await videoTask(r.op, r.args) });
    } catch (e) {
      await this.call('respond', { id: r.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
}

export const desktop = new Desktop();
