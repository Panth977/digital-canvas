/**
 * The device bridge's mailbox in Firestore (firebase-admin side, the relay).
 * Same documents as the IceBase schema (backend/icebase/schema.ts: users,
 * devices, bridgeJobs, bridgeParts) and the rules that let a signed-in device
 * see and answer only its own user's jobs.
 *
 *   users/{uid}                          processing, activeDevice (functions only)
 *   users/{uid}/devices/{id}             name, platform, enabled, lastSeen (server time), appVersion
 *   users/{uid}/bridgeJobs/{id}          device, tool, args, state, result | parts, error, createdAt, expiresAt (TTL)
 *   users/{uid}/bridgeJobs/{id}/parts/{n} data, expiresAt (TTL)
 */
import { FieldValue, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import type { BridgeStore } from '../../../packages/mcp/src/bridge/store.ts';
import type { BridgeSettings, DeviceRow, JobPatch, JobRow } from '../../../packages/mcp/src/bridge/types.ts';

const ms = (v: unknown): number | undefined => (v instanceof Timestamp ? v.toMillis() : typeof v === 'number' ? v : undefined);
const safeId = (id: string) => !!id && !id.includes('/') && id.length < 200;

function jobOf(id: string, d: DocumentData): JobRow {
  return {
    id, device: String(d.device ?? ''), tool: String(d.tool ?? ''), args: String(d.args ?? '{}'), state: d.state,
    createdAt: ms(d.createdAt) ?? 0, expiresAt: ms(d.expiresAt) ?? 0,
    ...(ms(d.startedAt) !== undefined ? { startedAt: ms(d.startedAt)! } : {}),
    ...(ms(d.finishedAt) !== undefined ? { finishedAt: ms(d.finishedAt)! } : {}),
    ...(typeof d.result === 'string' ? { result: d.result } : {}),
    ...(typeof d.parts === 'number' ? { parts: d.parts } : {}),
    ...(typeof d.error === 'string' ? { error: d.error } : {}),
  };
}

export class FirestoreBridgeStore implements BridgeStore {
  /** Parts counts seen while watching, so cleanup needs no extra reads. */
  private partsOf = new Map<string, number>();
  constructor(private db: Firestore) {}
  private user = (uid: string) => this.db.collection('users').doc(uid);
  private jobs = (uid: string) => this.user(uid).collection('bridgeJobs');

  async settings(uid: string): Promise<BridgeSettings> {
    const d = (await this.user(uid).get()).data() ?? {};
    return {
      ...(typeof d.email === 'string' ? { email: d.email } : {}),
      ...(d.processing === 'device' || d.processing === 'cloud' ? { processing: d.processing } : {}),
      ...(typeof d.activeDevice === 'string' && d.activeDevice ? { activeDevice: d.activeDevice } : {}),
    };
  }

  async setActiveDevice(uid: string, deviceId: string | null): Promise<void> {
    await this.user(uid).set({ activeDevice: deviceId ?? FieldValue.delete() }, { merge: true });
  }

  async devices(uid: string): Promise<DeviceRow[]> {
    const snap = await this.user(uid).collection('devices').get();
    return snap.docs.map((s) => {
      const d = s.data();
      return {
        id: s.id, name: String(d.name ?? 'Device'), platform: String(d.platform ?? 'web'), enabled: d.enabled === true, lastSeen: ms(d.lastSeen) ?? 0,
        ...(typeof d.appVersion === 'string' ? { appVersion: d.appVersion } : {}),
      };
    });
  }

  async createJob(uid: string, job: JobRow): Promise<void> {
    await this.jobs(uid).doc(job.id).create({
      device: job.device, tool: job.tool, args: job.args, state: job.state,
      createdAt: Timestamp.fromMillis(job.createdAt), expiresAt: Timestamp.fromMillis(job.expiresAt),
    });
  }

  async updateJob(uid: string, id: string, patch: JobPatch): Promise<void> {
    const p: DocumentData = { ...patch };
    for (const k of ['startedAt', 'finishedAt'] as const) if (typeof p[k] === 'number') p[k] = Timestamp.fromMillis(p[k]);
    await this.jobs(uid).doc(id).update(p);
  }

  watchJob(uid: string, id: string, cb: (job: JobRow | null) => void): () => void {
    if (!safeId(id)) { queueMicrotask(() => cb(null)); return () => {}; }
    return this.jobs(uid).doc(id).onSnapshot((s) => {
      const job = s.exists ? jobOf(id, s.data()!) : null;
      if (job?.parts) this.partsOf.set(`${uid}/${id}`, job.parts);
      cb(job);
    }, () => cb(null));
  }

  async readParts(uid: string, id: string, n: number): Promise<string[]> {
    const col = this.jobs(uid).doc(id).collection('parts');
    const snaps = await this.db.getAll(...Array.from({ length: n }, (_, i) => col.doc(String(i))));
    return snaps.map((s, i) => {
      const data = s.data()?.data;
      if (typeof data !== 'string') throw new Error(`the device's answer is incomplete (part ${i + 1} of ${n} is missing)`);
      return data;
    });
  }

  async deleteJob(uid: string, id: string): Promise<void> {
    if (!safeId(id)) return;
    const ref = this.jobs(uid).doc(id);
    const n = this.partsOf.get(`${uid}/${id}`) ?? 0;
    this.partsOf.delete(`${uid}/${id}`);
    const batch = this.db.batch();
    for (let i = 0; i < n; i++) batch.delete(ref.collection('parts').doc(String(i)));
    batch.delete(ref);
    await batch.commit();
  }
}
