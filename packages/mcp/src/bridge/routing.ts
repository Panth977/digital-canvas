/** Where a tool call runs: pure decisions, unit-tested (test/bridge.test.ts). */
import { isOnline, type BridgeSettings, type DeviceRow, type ProcessingMode } from './types.ts';

/** Who may run tools in our cloud (server-side config). Everyone else uses a device. */
export const DEFAULT_CLOUD_ALLOWLIST = ['ppanth977@gmail.com'];

/** Parse DC_CLOUD_ALLOWLIST ("a@x.com, b@y.com"); unset → the default list. */
export function parseAllowlist(env: string | undefined): string[] {
  if (env === undefined) return DEFAULT_CLOUD_ALLOWLIST;
  return env.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export interface ModeInfo {
  /** Where tools run now. */
  mode: ProcessingMode;
  /** May this user pick cloud? */
  cloudAllowed: boolean;
  /** What the user picked (or the default for them). */
  requested: ProcessingMode;
}

/**
 * Cloud only for allowlisted users (it is their default too, as before the
 * bridge); everyone else is forced to device whatever is stored.
 */
export function effectiveMode(settings: BridgeSettings, allowlist: readonly string[]): ModeInfo {
  const email = (settings.email ?? '').trim().toLowerCase();
  const cloudAllowed = !!email && allowlist.map((a) => a.toLowerCase()).includes(email);
  const requested: ProcessingMode = settings.processing ?? (cloudAllowed ? 'cloud' : 'device');
  return { mode: cloudAllowed && requested === 'cloud' ? 'cloud' : 'device', cloudAllowed, requested };
}

export type Route =
  | { kind: 'device'; device: DeviceRow; auto: boolean }
  | { kind: 'none'; message: string }
  | { kind: 'choose'; message: string; devices: DeviceRow[] };

export const NO_DEVICE_MESSAGE =
  'No device is available to run Digital Canvas tools. Your Digital Canvas account processes AI requests on your own device. ' +
  'Ask the user to open Digital Canvas (https://digital-canvas-p977.web.app, the installed app, or the Android app) on a computer or phone, ' +
  'signed in with the same Google account, and turn on "Let AI use this device" (File › Settings › AI and devices). Then try again.';

const label = (d: DeviceRow) => `${d.name} (id ${d.id})`;

/**
 * The device for a call: the chosen one when it is online; the only online
 * one when there is exactly one; otherwise a message the agent can act on.
 */
export function pickDevice(settings: BridgeSettings, devices: readonly DeviceRow[], now: number): Route {
  const online = devices.filter((d) => isOnline(d, now)).sort((a, b) => b.lastSeen - a.lastSeen);
  const chosen = settings.activeDevice ? devices.find((d) => d.id === settings.activeDevice) : undefined;
  if (chosen && isOnline(chosen, now)) return { kind: 'device', device: chosen, auto: false };
  if (!online.length) {
    return { kind: 'none', message: chosen ? `The device you chose, ${chosen.name}, is offline. ${NO_DEVICE_MESSAGE}` : NO_DEVICE_MESSAGE };
  }
  if (online.length === 1 && !chosen) return { kind: 'device', device: online[0]!, auto: true };
  const why = chosen
    ? `The device chosen for Digital Canvas, ${chosen.name}, is offline, and ${online.length === 1 ? 'another device is' : `${online.length} other devices are`} online`
    : `${online.length} of the user's devices are online`;
  return {
    kind: 'choose',
    devices: online,
    message: `${why}: ${online.map(label).join('; ')}. Ask the user which device Digital Canvas should use, then call use_device with its id and repeat this call.`,
  };
}
