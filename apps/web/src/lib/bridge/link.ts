/**
 * The device's end of the bridge mailbox in Firestore (IceBase client, signed
 * in as the user with the custom token from googleSignIn). Firestore rules
 * keep it to the user's own documents (backend/icebase/rules/firestore.rules).
 */
import {
  Timestamp, collection, deleteDoc, doc, getFirestore, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from '@panth977/icebase/firestore';
import { bridgeJobs, bridgeParts, devices } from '@digital-canvas/backend/schema';
import type { DeviceLink, DeviceRow, JobPatch, JobRow } from '@digital-canvas/mcp/bridge';
import { JOB_TTL_MS } from '@digital-canvas/mcp/bridge';
import { app } from '../icebase.ts';

const ms = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : typeof v === 'number' ? v : 0);

export function firestoreLink(uid: string): DeviceLink {
  const db = getFirestore(app);
  const devs = collection(db, devices, uid);
  const jobs = collection(db, bridgeJobs, uid);
  return {
    async putDevice(row: DeviceRow) {
      await setDoc(doc(devs, row.id), {
        name: row.name.slice(0, 80), platform: row.platform.slice(0, 20), enabled: row.enabled, lastSeen: serverTimestamp(),
        ...(row.appVersion ? { appVersion: row.appVersion.slice(0, 40) } : {}),
      });
    },
    async removeDevice(id: string) {
      await deleteDoc(doc(devs, id));
    },
    listenJobs(deviceId, cb, onError) {
      return onSnapshot(query(jobs, where('device', '==', deviceId)), (snap) => {
        cb(snap.docs.map((d): JobRow => {
          const j = d.data();
          return {
            id: d.id, device: j.device, tool: j.tool, args: j.args, state: j.state, createdAt: ms(j.createdAt), expiresAt: ms(j.expiresAt),
            ...(j.result !== undefined ? { result: j.result } : {}), ...(j.parts !== undefined ? { parts: j.parts } : {}), ...(j.error !== undefined ? { error: j.error } : {}),
          };
        }));
      }, (e) => onError?.(e));
    },
    async updateJob(id: string, patch: JobPatch) {
      const p: Record<string, unknown> = { ...patch };
      // the device's clock may be off: times it writes are the server's
      if ('startedAt' in p) p.startedAt = serverTimestamp();
      if ('finishedAt' in p) p.finishedAt = serverTimestamp();
      await updateDoc(doc(jobs, id), p as never);
    },
    async putParts(id: string, parts: string[]) {
      const col = collection(db, bridgeParts, uid, id);
      const expiresAt = Timestamp.fromMillis(Date.now() + JOB_TTL_MS);
      // ≤ 900 KB each; a batch is at most 10 MiB, so a few per commit
      for (let i = 0; i < parts.length; i += 8) {
        const b = writeBatch(db);
        parts.slice(i, i + 8).forEach((data, k) => b.set(doc(col, String(i + k)), { data, expiresAt }));
        await b.commit();
      }
    },
  };
}

/** The user's devices, now and on every change (for the AI and devices panel). */
export function watchDevices(uid: string, cb: (list: DeviceRow[]) => void, onError?: (e: Error) => void): () => void {
  const devs = collection(getFirestore(app), devices, uid);
  return onSnapshot(devs, (snap) => {
    cb(snap.docs.map((d) => {
      const x = d.data();
      return { id: d.id, name: x.name, platform: x.platform, enabled: x.enabled, lastSeen: ms(x.lastSeen), ...(x.appVersion ? { appVersion: x.appVersion } : {}) };
    }));
  }, (e) => onError?.(e));
}

/** Forget a device (it re-registers if AI is turned on there again). */
export async function forgetDevice(uid: string, id: string): Promise<void> {
  await deleteDoc(doc(collection(getFirestore(app), devices, uid), id));
}
