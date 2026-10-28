/**
 * The mailbox, from both ends. The relay (Cloud Function, admin rights) uses a
 * BridgeStore; a device (the user's browser, signed in as the user) uses a
 * DeviceLink, which can only touch that user's own documents (Firestore rules).
 *
 * Production: backend/mcp/src/bridge.ts (firebase-admin) and
 * apps/web/src/lib/bridge/link.ts (IceBase client). Tests: MemoryBridge.
 */
import type { BridgeSettings, DeviceRow, JobPatch, JobRow } from './types.ts';

export interface BridgeStore {
  settings(uid: string): Promise<BridgeSettings>;
  setActiveDevice(uid: string, deviceId: string | null): Promise<void>;
  devices(uid: string): Promise<DeviceRow[]>;
  createJob(uid: string, job: JobRow): Promise<void>;
  updateJob(uid: string, id: string, patch: JobPatch): Promise<void>;
  /** Calls back with the job now and on every change (null once deleted). Returns unsubscribe. */
  watchJob(uid: string, id: string, cb: (job: JobRow | null) => void): () => void;
  readParts(uid: string, id: string, n: number): Promise<string[]>;
  /** The job and its parts. */
  deleteJob(uid: string, id: string): Promise<void>;
}

export interface DeviceLink {
  /** Register or refresh this device (heartbeat). */
  putDevice(row: DeviceRow): Promise<void>;
  removeDevice(id: string): Promise<void>;
  /** Jobs addressed to `deviceId`, now and on every change. Returns unsubscribe. */
  listenJobs(deviceId: string, cb: (jobs: JobRow[]) => void, onError?: (e: Error) => void): () => void;
  updateJob(id: string, patch: JobPatch): Promise<void>;
  putParts(id: string, parts: string[]): Promise<void>;
}

const clone = <T>(v: T): T => structuredClone(v);

/** Both ends in memory (unit tests, the e2e test's relay). */
export class MemoryBridge implements BridgeStore {
  users = new Map<string, BridgeSettings>();
  deviceRows = new Map<string, Map<string, DeviceRow>>();
  jobs = new Map<string, Map<string, JobRow>>();
  parts = new Map<string, string[]>();
  private jobWatchers = new Set<{ uid: string; id: string; cb: (j: JobRow | null) => void }>();
  private listWatchers = new Set<{ uid: string; device: string; cb: (j: JobRow[]) => void }>();
  /** Every write, for assertions: [op, path]. */
  log: [string, string][] = [];

  private bucket<T>(m: Map<string, Map<string, T>>, uid: string): Map<string, T> {
    let b = m.get(uid);
    if (!b) m.set(uid, (b = new Map()));
    return b;
  }

  private notify(uid: string, id: string): void {
    const job = this.jobs.get(uid)?.get(id) ?? null;
    for (const w of this.jobWatchers) if (w.uid === uid && w.id === id) queueMicrotask(() => w.cb(job && clone(job)));
    for (const w of this.listWatchers) if (w.uid === uid && (!job || job.device === w.device)) {
      const list = [...this.bucket(this.jobs, uid).values()].filter((j) => j.device === w.device).map(clone);
      queueMicrotask(() => w.cb(list));
    }
  }

  setSettings(uid: string, s: BridgeSettings): void {
    this.users.set(uid, { ...this.users.get(uid), ...s });
  }

  // ---- relay side

  async settings(uid: string) { return clone(this.users.get(uid) ?? {}); }
  async setActiveDevice(uid: string, deviceId: string | null) {
    const s = { ...this.users.get(uid) };
    if (deviceId) s.activeDevice = deviceId; else delete s.activeDevice;
    this.users.set(uid, s);
    this.log.push(['set', `users/${uid}.activeDevice`]);
  }
  async devices(uid: string) { return [...this.bucket(this.deviceRows, uid).values()].map(clone); }
  async createJob(uid: string, job: JobRow) {
    this.bucket(this.jobs, uid).set(job.id, clone(job));
    this.log.push(['create', `users/${uid}/bridgeJobs/${job.id}`]);
    this.notify(uid, job.id);
  }
  async updateJob(uid: string, id: string, patch: JobPatch) {
    const j = this.jobs.get(uid)?.get(id);
    if (!j) throw new Error(`no job ${id}`);
    Object.assign(j, clone(patch));
    this.log.push(['update', `users/${uid}/bridgeJobs/${id}`]);
    this.notify(uid, id);
  }
  watchJob(uid: string, id: string, cb: (job: JobRow | null) => void) {
    const w = { uid, id, cb };
    this.jobWatchers.add(w);
    const job = this.jobs.get(uid)?.get(id) ?? null;
    queueMicrotask(() => { if (this.jobWatchers.has(w)) cb(job && clone(job)); });
    return () => void this.jobWatchers.delete(w);
  }
  async readParts(uid: string, id: string, n: number) {
    const p = this.parts.get(`${uid}/${id}`) ?? [];
    if (p.length < n) throw new Error(`job ${id}: ${p.length} of ${n} parts`);
    return p.slice(0, n);
  }
  async deleteJob(uid: string, id: string) {
    this.jobs.get(uid)?.delete(id);
    this.parts.delete(`${uid}/${id}`);
    this.log.push(['delete', `users/${uid}/bridgeJobs/${id}`]);
    this.notify(uid, id);
  }

  // ---- device side (signed in as `uid`)

  link(uid: string): DeviceLink {
    return {
      putDevice: async (row) => { this.bucket(this.deviceRows, uid).set(row.id, clone(row)); },
      removeDevice: async (id) => { this.bucket(this.deviceRows, uid).delete(id); },
      listenJobs: (device, cb) => {
        const w = { uid, device, cb };
        this.listWatchers.add(w);
        const list = [...this.bucket(this.jobs, uid).values()].filter((j) => j.device === device).map(clone);
        queueMicrotask(() => { if (this.listWatchers.has(w)) cb(list); });
        return () => void this.listWatchers.delete(w);
      },
      updateJob: (id, patch) => this.updateJob(uid, id, patch),
      putParts: async (id, parts) => { this.parts.set(`${uid}/${id}`, [...parts]); this.log.push(['parts', `users/${uid}/bridgeJobs/${id}/parts`]); },
    };
  }
}
