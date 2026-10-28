/**
 * The small, always-loaded part of "Let AI use this device": the toggle (kept
 * in this browser), the status the indicator shows, this device's id and
 * name, and the account's processing mode (aiSettings). The heavy part
 * (Firestore, the device worker) is bridge.svelte.ts, imported on demand.
 */
import type { DeviceLink, DeviceRow } from '@digital-canvas/mcp/bridge';
import { account } from '../account.svelte.ts';
import { aiSettings } from '../icebase.ts';
import { isNative, nativePlatform } from '../native/platform.ts';

const KEY_ID = 'dc.bridge.deviceId';
const KEY_ON = 'dc.bridge.enabled';

const store = (): Storage | null => (typeof localStorage === 'undefined' ? null : localStorage);

/** This browser profile / app install, for the device registry. */
export function deviceId(): string {
  const s = store();
  let id = s?.getItem(KEY_ID);
  if (!id) {
    const b = new Uint8Array(9);
    crypto.getRandomValues(b);
    id = `d_${[...b].map((x) => x.toString(36).padStart(2, '0')).join('').slice(0, 14)}`;
    s?.setItem(KEY_ID, id);
  }
  return id;
}

export function devicePlatform(): string {
  if (isNative()) return nativePlatform();
  if (typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone), (display-mode: window-controls-overlay)').matches) return 'pwa';
  return 'web';
}

/** "Panth's Mac – Chrome", "Ada's Android phone – app". */
export function deviceName(person?: string): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1) ? 'iPad'
    : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android phone' : 'Android tablet') : /Macintosh|Mac OS X/.test(ua) ? 'Mac'
      : /Windows/.test(ua) ? 'Windows PC' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux PC' : 'computer';
  const p = devicePlatform();
  const app = p === 'android' || p === 'ios' ? 'app' : p === 'pwa' ? 'Digital Canvas app'
    : /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  const first = (person ?? '').trim().split(/\s+/)[0];
  return `${first ? `${first}'s ` : ''}${os} – ${app}`.slice(0, 80);
}

export interface AiSettings {
  mode: 'device' | 'cloud';
  requested: 'device' | 'cloud';
  cloudAllowed: boolean;
  activeDevice?: string;
}

class BridgeUi {
  /** "Let AI use this device" (this browser). */
  enabled = $state(store()?.getItem(KEY_ON) === '1');
  status = $state<'off' | 'starting' | 'on' | 'error'>('off');
  /** Jobs waiting or running here. */
  busy = $state(0);
  tool = $state<string | null>(null);
  error = $state('');
  settings = $state<AiSettings | null>(null);
  devices = $state<DeviceRow[]>([]);
  /** The AI and devices panel is open. */
  open = $state(false);
  /** Tests only (dev builds): a mailbox instead of Firestore. */
  testLink: DeviceLink | null = null;
  readonly id = deviceId();

  /** Turn "Let AI use this device" on or off. */
  async setEnabled(on: boolean): Promise<void> {
    this.enabled = on;
    store()?.setItem(KEY_ON, on ? '1' : '0');
    const m = await import('./bridge.svelte.ts');
    if (on) await m.startBridge(this.testLink ?? undefined).catch(() => {});
    else await m.stopBridge();
  }

  /** Start on load / sign-in when it was left on. */
  async resume(): Promise<void> {
    if (!this.enabled || this.status === 'on' || this.status === 'starting' || !account.user) return;
    const m = await import('./bridge.svelte.ts');
    await m.startBridge(this.testLink ?? undefined).catch(() => {});
  }

  async loadSettings(): Promise<void> {
    try { this.settings = await aiSettings({}); } catch (e) { this.error = e instanceof Error ? e.message : String(e); }
  }

  async setProcessing(processing: 'device' | 'cloud'): Promise<void> {
    this.settings = await aiSettings({ processing });
  }

  async chooseDevice(id: string | null): Promise<void> {
    this.settings = await aiSettings({ activeDevice: id ?? '' });
  }

  /** Watch the device list while the panel is open. */
  async watch(): Promise<() => void> {
    const uid = account.user?.uid;
    if (!uid || this.testLink) return () => {};
    const { watchDevices } = await import('./link.ts');
    return watchDevices(uid, (list) => (this.devices = list), (e) => (this.error = e.message));
  }

  async forget(id: string): Promise<void> {
    const uid = account.user?.uid;
    if (!uid) return;
    if (id === this.id && this.enabled) await this.setEnabled(false);
    const { forgetDevice } = await import('./link.ts');
    await forgetDevice(uid, id);
  }
}

export const bridgeUi = new BridgeUi();
if (import.meta.env.DEV) (window as unknown as { __bridgeUi?: BridgeUi & { load: () => Promise<unknown> } }).__bridgeUi = Object.assign(bridgeUi, { load: () => import('./bridge.svelte.ts') });
