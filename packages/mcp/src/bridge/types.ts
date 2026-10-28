/**
 * The device bridge: the remote MCP server (our Cloud Function) is a thin relay
 * and the tools run on one of the user's own devices (the web app / PWA, or the
 * Android app), which already has CanvasKit and a Drive token.
 *
 * Mailbox (Firestore in production, memory in tests):
 *
 *   users/{uid}                       processing ('device' | 'cloud'), activeDevice  (written by functions only)
 *   users/{uid}/devices/{deviceId}    name, platform, enabled, lastSeen               (written by the device)
 *   users/{uid}/bridgeJobs/{jobId}    device, tool, args → state, result | parts, error (created by the relay,
 *   users/{uid}/bridgeJobs/{jobId}/parts/{n}                                           answered by the device)
 *
 * A tool call in device mode: the relay picks the device, writes a job, and
 * waits on it; the device (listening to jobs addressed to it) marks it
 * running, runs the tool, writes the result (chunked over 900 KB: Firestore's
 * documents hold 1 MiB), and the relay returns it and deletes the job. Jobs
 * carry `expiresAt` for a Firestore TTL policy, so nothing lingers.
 */

export type ProcessingMode = 'device' | 'cloud';

/** What the user chose (users/{uid}); the allowlist decides whether cloud is allowed. */
export interface BridgeSettings {
  email?: string;
  processing?: ProcessingMode;
  /** The device the user (or the agent, with use_device) picked. */
  activeDevice?: string;
}

/** users/{uid}/devices/{id}: written by the device itself. */
export interface DeviceRow {
  id: string;
  /** "Panth's Mac – Chrome" */
  name: string;
  /** 'web' | 'pwa' | 'android' | 'ios' | … */
  platform: string;
  /** "Let AI use this device" is on. */
  enabled: boolean;
  /** Heartbeat, ms since epoch. */
  lastSeen: number;
  appVersion?: string;
}

export type JobState = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

/** users/{uid}/bridgeJobs/{id} */
export interface JobRow {
  id: string;
  device: string;
  tool: string;
  /** JSON of the tool's arguments. */
  args: string;
  state: JobState;
  createdAt: number;
  /** TTL: the store deletes the job (and its parts) after this. */
  expiresAt: number;
  startedAt?: number;
  finishedAt?: number;
  /** JSON of the CallToolResult (small results). */
  result?: string;
  /** Number of `parts` documents holding the result JSON (large results). */
  parts?: number;
  error?: string;
}

export type JobPatch = Partial<Pick<JobRow, 'state' | 'startedAt' | 'finishedAt' | 'result' | 'parts' | 'error'>>;

/** A device counts as online when it has been seen this recently. */
export const ONLINE_MS = 60_000;
/** How often a device says it is still there. */
export const HEARTBEAT_MS = 20_000;
/** A device must take a job within this time (else it is asleep / the tab is frozen). */
export const PICKUP_MS = 20_000;
/** Longest a relayed tool call may take (exports return a job id well before this). */
export const CALL_MS = 240_000;
/** How long job documents live (TTL) if nobody deletes them. */
export const JOB_TTL_MS = 60 * 60_000;
/** Result JSON up to this size goes in the job document; larger is split into parts of this size. */
export const PART_BYTES = 900_000;
/** Largest result relayed (bigger images are dropped with a note). */
export const MAX_RESULT_BYTES = 16 * 1024 * 1024;

export function isOnline(d: DeviceRow, now: number): boolean {
  return d.enabled && now - d.lastSeen < ONLINE_MS;
}
