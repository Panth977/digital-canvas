/** The bridge mailbox with the app's own IceBase Firestore (signed in as the user). See link-core.ts. */
import { getFirestore } from '@panth977/icebase/firestore';
import type { DeviceLink, DeviceRow } from '@digital-canvas/mcp/bridge';
import { app } from '../icebase.ts';
import { deviceLink, forgetDevice as forget, watchDevices as watch } from './link-core.ts';

export const firestoreLink = (uid: string): DeviceLink => deviceLink(getFirestore(app), uid);
export const watchDevices = (uid: string, cb: (list: DeviceRow[]) => void, onError?: (e: Error) => void) => watch(getFirestore(app), uid, cb, onError);
export const forgetDevice = (uid: string, id: string) => forget(getFirestore(app), uid, id);
