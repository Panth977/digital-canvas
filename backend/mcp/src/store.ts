/**
 * The remote MCP server's OAuth data in Firestore (firebase-admin).
 *
 *   mcpClients/{clientId}                 registered apps (DCR)
 *   mcpPending/{id}                       authorize requests waiting for Google (15 min)
 *   mcpTokens/{sha256(token)}             codes, access and refresh tokens (hashes only)
 *   users/{uid}/mcpGrants/{clientId}      what the person allowed each app (the revocation switch)
 *   users/{uid}                           same doc the web sign-in keeps (email, name, loginCount…)
 *   users/{uid}/private/drive             the encrypted Google refresh token, shared with the web app
 *
 * Every expiring row has `ttl` (a Timestamp) so a Firestore TTL policy can sweep them.
 */
import { FieldValue, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import type { ClientRow, DriveRow, GrantRow, OAuthStore, PendingRow, TokenRow, UserInfo } from '../../../packages/mcp/src/remote/store.ts';

const strip = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
const ttl = (ms: number) => Timestamp.fromMillis(ms);

export class FirestoreOAuthStore implements OAuthStore {
  constructor(private db: Firestore) {}
  private client = (id: string) => this.db.collection('mcpClients').doc(id);
  private pending = (id: string) => this.db.collection('mcpPending').doc(id);
  private token = (h: string) => this.db.collection('mcpTokens').doc(h);
  private grant = (uid: string, g: string) => this.db.collection('users').doc(uid).collection('mcpGrants').doc(g);
  private drive = (uid: string) => this.db.collection('users').doc(uid).collection('private').doc('drive');

  async getClient(id: string) { if (!id || id.includes('/')) return null; const s = await this.client(id).get(); return s.exists ? (s.data() as ClientRow) : null; }
  async putClient(row: ClientRow) { await this.client(row.id).set(strip(row)); }

  async putPending(row: PendingRow) { await this.pending(row.id).set({ ...strip(row), ttl: ttl(row.expiresAt) }); }
  async getPending(id: string) {
    if (!id || id.includes('/')) return null;
    const s = await this.pending(id).get();
    if (!s.exists) return null;
    const { ttl: _t, ...row } = s.data()!;
    return row as PendingRow;
  }
  async deletePending(id: string) { await this.pending(id).delete(); }

  private row(d: DocumentData): TokenRow { const { ttl: _t, ...r } = d; return r as TokenRow; }
  async getToken(h: string) { const s = await this.token(h).get(); return s.exists ? this.row(s.data()!) : null; }
  async putToken(h: string, row: TokenRow) { await this.token(h).set({ ...strip(row), ttl: ttl(row.expiresAt) }); }
  async deleteToken(h: string) { await this.token(h).delete(); }
  async takeToken(h: string) {
    return this.db.runTransaction(async (tx) => {
      const s = await tx.get(this.token(h));
      if (!s.exists) return null;
      tx.delete(s.ref);
      return this.row(s.data()!);
    });
  }
  async markTokenUsed(h: string, now: number) {
    return this.db.runTransaction(async (tx) => {
      const s = await tx.get(this.token(h));
      if (!s.exists) return null;
      const before = this.row(s.data()!);
      if (before.usedAt === undefined) tx.update(s.ref, { usedAt: now });
      return before;
    });
  }
  async deleteGrantTokens(uid: string, grantId: string) {
    const q = await this.db.collection('mcpTokens').where('uid', '==', uid).where('grantId', '==', grantId).get();
    for (let i = 0; i < q.docs.length; i += 400) {
      const b = this.db.batch();
      for (const d of q.docs.slice(i, i + 400)) b.delete(d.ref);
      await b.commit();
    }
  }

  async getGrant(uid: string, g: string) { const s = await this.grant(uid, g).get(); return s.exists ? (s.data() as GrantRow) : null; }
  async putGrant(uid: string, g: string, row: GrantRow) { await this.grant(uid, g).set(row); }
  async deleteGrant(uid: string, g: string) { await this.grant(uid, g).delete(); }

  async upsertUser(uid: string, info: UserInfo) {
    const ref = this.db.collection('users').doc(uid);
    const s = await ref.get();
    await ref.set({
      email: info.email, name: info.name ?? info.email, ...(info.photo ? { photo: info.photo } : {}),
      loginCount: FieldValue.increment(1), lastLogin: FieldValue.serverTimestamp(), ...(s.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    }, { merge: true });
  }
  async getDrive(uid: string) {
    const s = await this.drive(uid).get();
    const d = s.data() as { refreshToken?: string; scope?: string } | undefined;
    return d?.refreshToken ? ({ refreshToken: d.refreshToken, scope: d.scope ?? '' } as DriveRow) : null;
  }
  async putDrive(uid: string, row: DriveRow) { await this.drive(uid).set({ refreshToken: row.refreshToken, scope: row.scope, updatedAt: FieldValue.serverTimestamp() }); }
  async deleteDrive(uid: string) { await this.drive(uid).delete(); }
}
