/**
 * The bridge mailbox on the Firestore emulator, with the real security rules
 * (backend/icebase/rules/firestore.rules): the relay's store (firebase-admin,
 * backend/mcp/src/bridge.ts) against a device signed in as the user (Firebase
 * JS SDK, as apps/web/src/lib/bridge/link.ts does through IceBase).
 *
 *   npm run test:bridge-emu    (firebase emulators:exec … vitest run this file)
 *
 * The last case uses the web app's own link (IceBase client, schema-checked writes).
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set.
 */
import { deleteApp as deleteClientApp, initializeApp as initClient, type FirebaseApp } from 'firebase/app';
import {
  collection, connectFirestoreEmulator, doc, getDoc, getFirestore as clientDb, onSnapshot, query, serverTimestamp, setDoc, Timestamp as CTimestamp, updateDoc, where, writeBatch,
  type Firestore as ClientDb,
} from 'firebase/firestore';
import { deleteApp as deleteAdminApp, initializeApp as initAdmin, type App } from 'firebase-admin/app';
import { getFirestore as adminDb, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeApp as initIceBase } from '@panth977/icebase/app';
import { getFirestore as iceBaseDb } from '@panth977/icebase/firestore';
import config from '@digital-canvas/backend/config';
import { FirestoreBridgeStore } from '../../../backend/mcp/src/bridge.ts';
import { deviceLink } from '../../../apps/web/src/lib/bridge/link-core.ts';
import { DeviceAgent, JOB_TTL_MS, Relay, type DeviceLink, type JobRow } from '../src/bridge/index.ts';

const HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = 'demo-dc-bridge';
const UID = 'google:111';

/** A device's link with the plain Firebase SDK (same documents and fields as the web app's). */
function sdkLink(db: ClientDb, uid: string): DeviceLink {
  const jobs = collection(db, 'users', uid, 'bridgeJobs');
  return {
    putDevice: (row) => setDoc(doc(db, 'users', uid, 'devices', row.id), { name: row.name, platform: row.platform, enabled: row.enabled, lastSeen: serverTimestamp() }),
    removeDevice: async () => {},
    listenJobs: (device, cb, onError) => onSnapshot(query(jobs, where('device', '==', device)), (s) => cb(s.docs.map((d) => {
      const j = d.data();
      return { id: d.id, device: j.device, tool: j.tool, args: j.args, state: j.state, createdAt: j.createdAt.toMillis(), expiresAt: j.expiresAt.toMillis() } as JobRow;
    })), (e) => onError?.(e)),
    updateJob: (id, patch) => {
      const p: Record<string, unknown> = { ...patch };
      if ('startedAt' in p) p.startedAt = serverTimestamp();
      if ('finishedAt' in p) p.finishedAt = serverTimestamp();
      return updateDoc(doc(jobs, id), p);
    },
    putParts: async (id, parts) => {
      const b = writeBatch(db);
      parts.forEach((data, i) => b.set(doc(db, 'users', uid, 'bridgeJobs', id, 'parts', String(i)), { data, expiresAt: CTimestamp.fromMillis(Date.now() + JOB_TTL_MS) }));
      await b.commit();
    },
  };
}

describe.skipIf(!HOST)('bridge mailbox on the Firestore emulator (rules)', () => {
  let admin: App;
  let adb: Firestore;
  let mine: FirebaseApp, theirs: FirebaseApp;
  let me: ClientDb, them: ClientDb;
  const [host, port] = (HOST ?? '127.0.0.1:8080').split(':');

  beforeAll(async () => {
    admin = initAdmin({ projectId: PROJECT }, 'bridge-admin');
    adb = adminDb(admin);
    mine = initClient({ projectId: PROJECT, apiKey: 'x' }, 'me');
    theirs = initClient({ projectId: PROJECT, apiKey: 'x' }, 'them');
    me = clientDb(mine);
    them = clientDb(theirs);
    connectFirestoreEmulator(me, host!, Number(port), { mockUserToken: { sub: UID, user_id: UID } });
    connectFirestoreEmulator(them, host!, Number(port), { mockUserToken: { sub: 'google:999', user_id: 'google:999' } });
    await adb.collection('users').doc(UID).set({ email: 'ada@example.com', name: 'Ada' });
  });
  afterAll(async () => {
    await deleteClientApp(mine);
    await deleteClientApp(theirs);
    await deleteAdminApp(admin);
  });

  it('a device registers itself with server time; nobody else can, and no extra fields', async () => {
    const ref = doc(me, 'users', UID, 'devices', 'mac');
    await setDoc(ref, { name: "Ada's Mac – Chrome", platform: 'web', enabled: true, lastSeen: serverTimestamp() });
    expect((await getDoc(ref)).data()?.enabled).toBe(true);
    await expect(setDoc(ref, { name: 'x', platform: 'web', enabled: true, lastSeen: CTimestamp.fromMillis(Date.now() + 86400e3) })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(setDoc(ref, { name: 'x', platform: 'web', enabled: true, lastSeen: serverTimestamp(), admin: true })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(setDoc(doc(them, 'users', UID, 'devices', 'evil'), { name: 'x', platform: 'web', enabled: true, lastSeen: serverTimestamp() })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(getDoc(doc(them, 'users', UID, 'devices', 'mac'))).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('only the relay creates jobs; the device may only move its job forward', async () => {
    const jobs = collection(me, 'users', UID, 'bridgeJobs');
    await expect(setDoc(doc(jobs, 'forged'), { device: 'mac', tool: 'delete_design', args: '{}', state: 'pending', createdAt: serverTimestamp(), expiresAt: serverTimestamp() })).rejects.toMatchObject({ code: 'permission-denied' });
    const store = new FirestoreBridgeStore(adb);
    const now = Date.now();
    await store.createJob(UID, { id: 'j1', device: 'mac', tool: 'render_page', args: '{"design_id":"d"}', state: 'pending', createdAt: now, expiresAt: now + JOB_TTL_MS });
    await expect(updateDoc(doc(jobs, 'j1'), { tool: 'delete_design' })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(updateDoc(doc(jobs, 'j1'), { state: 'pending' })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(getDoc(doc(them, 'users', UID, 'bridgeJobs', 'j1'))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(updateDoc(doc(them, 'users', UID, 'bridgeJobs', 'j1'), { state: 'running' })).rejects.toMatchObject({ code: 'permission-denied' });
    // parts only while running
    await expect(setDoc(doc(me, 'users', UID, 'bridgeJobs', 'j1', 'parts', '0'), { data: 'x', expiresAt: CTimestamp.now() })).rejects.toMatchObject({ code: 'permission-denied' });
    await updateDoc(doc(jobs, 'j1'), { state: 'running', startedAt: serverTimestamp() });
    await setDoc(doc(me, 'users', UID, 'bridgeJobs', 'j1', 'parts', '0'), { data: 'x', expiresAt: CTimestamp.now() });
    await updateDoc(doc(jobs, 'j1'), { state: 'done', parts: 1, finishedAt: serverTimestamp() });
    await expect(updateDoc(doc(jobs, 'j1'), { state: 'running' })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(await store.readParts(UID, 'j1', 1)).toEqual(['x']);
    await store.deleteJob(UID, 'j1');
    expect((await adb.doc(`users/${UID}/bridgeJobs/j1`).get()).exists).toBe(false);
    expect((await adb.doc(`users/${UID}/bridgeJobs/j1/parts/0`).get()).exists).toBe(false);
  });

  it('a whole call: relay (admin) → device agent (signed-in client) → chunked result → cleaned up', async () => {
    const store = new FirestoreBridgeStore(adb);
    const big = 'é'.repeat(700_000); // ≈ 1.4 MB of UTF-8: two parts
    const agent = new DeviceAgent(sdkLink(me, UID), {
      id: 'mac', name: "Ada's Mac – Chrome", platform: 'web', heartbeatMs: 0,
      execute: async (tool, args) => ({ content: [{ type: 'text', text: JSON.stringify({ tool, args }) }, { type: 'text', text: big }] }),
    });
    await agent.start();
    try {
      const relay = new Relay({ store, uid: UID, allowlist: [], pickupMs: 10_000 });
      expect((await relay.mode()).mode).toBe('device');
      const res = await relay.call('render_page', { design_id: 'd1', size: 512 }, {}, async () => { throw new Error('ran in the cloud'); });
      expect(res.isError).toBeFalsy();
      expect(JSON.parse((res.content[0] as { text: string }).text)).toEqual({ tool: 'render_page', args: { design_id: 'd1', size: 512 } });
      expect((res.content[1] as { text: string }).text).toBe(big);
      const left = await adb.collection(`users/${UID}/bridgeJobs`).get();
      expect(left.size).toBe(0);
      expect((await adb.collectionGroup('parts').get()).size).toBe(0);
      const devices = await store.devices(UID);
      expect(devices.find((d) => d.id === 'mac')).toMatchObject({ enabled: true, name: "Ada's Mac – Chrome" });
      expect(Math.abs(devices.find((d) => d.id === 'mac')!.lastSeen - Date.now())).toBeLessThan(30_000);
      await store.setActiveDevice(UID, 'mac');
      expect((await store.settings(UID)).activeDevice).toBe('mac');
      await store.setActiveDevice(UID, null);
      expect((await store.settings(UID)).activeDevice).toBeUndefined();
    } finally {
      await agent.stop();
    }
  });

  it('the web app\'s IceBase link passes the schema and the rules', async () => {
    const web = { projectId: PROJECT, apiKey: 'x', appId: '1:1:web:1' };
    const ib = initIceBase(config, 'prod', { name: 'emu-web', firebase: web } as never);
    // IceBase's Firestore sits on this Firebase app: point it at the emulator, signed in as the user
    const native = initClient(web, 'icebase:emu-web');
    connectFirestoreEmulator(clientDb(native), host!, Number(port), { mockUserToken: { sub: UID, user_id: UID } });
    const agent = new DeviceAgent(deviceLink(iceBaseDb(ib), UID), {
      id: 'pixel', name: "Ada's Android phone – app", platform: 'android', heartbeatMs: 0,
      execute: async (tool) => ({ content: [{ type: 'text', text: tool }, { type: 'image', data: 'A'.repeat(1_200_000), mimeType: 'image/png' }] }),
    });
    await agent.start();
    try {
      const store = new FirestoreBridgeStore(adb);
      await store.setActiveDevice(UID, 'pixel');
      const relay = new Relay({ store, uid: UID, allowlist: [], pickupMs: 10_000 });
      const res = await relay.call('render_page', { design_id: 'd1' }, {}, async () => { throw new Error('ran in the cloud'); });
      expect(res.isError, JSON.stringify(res).slice(0, 300)).toBeFalsy();
      expect(res.content[0]).toEqual({ type: 'text', text: 'render_page' });
      expect((res.content[1] as { data: string }).data.length).toBe(1_200_000);
      expect((await store.devices(UID)).find((d) => d.id === 'pixel')).toMatchObject({ platform: 'android', enabled: true });
      expect((await adb.collection(`users/${UID}/bridgeJobs`).get()).size).toBe(0);
    } finally {
      await agent.stop();
      await deleteClientApp(native).catch(() => {});
    }
    expect((await store0()).find((d) => d.id === 'pixel')?.enabled).toBe(false);
  });
  const store0 = () => new FirestoreBridgeStore(adb).devices(UID);
});
