import { describe, expect, it } from 'vitest';
import { emailKey, inboxFor, isDesign, tokenEmail } from '../functions/src/shares.ts';

describe('share inbox helpers', () => {
  it('keys an email case- and space-insensitively', () => {
    expect(emailKey(' Mr.Royal2001@Gmail.com ')).toBe(emailKey('mr.royal2001@gmail.com'));
    expect(emailKey('a@b.c')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reads the account email from userinfo only when Google verified it', () => {
    expect(tokenEmail({ email: 'A@b.com', email_verified: true })).toBe('a@b.com');
    expect(tokenEmail({ email: 'a@b.com', email_verified: 'true' })).toBe('a@b.com');
    expect(tokenEmail({ email: 'a@b.com', email_verified: false })).toBeNull();
    expect(tokenEmail({})).toBeNull();
    expect(tokenEmail({ error: 'invalid_token', email: 'a@b.com', email_verified: true })).toBeNull();
  });

  it('lists every person with access except the owner, with role and title', () => {
    const m = inboxFor({
      id: 'f1', name: 'Zeel & Daivik — Photo Book 2020.dcanvas', appProperties: { dcDocId: 'd_1' },
      owners: [{ displayName: 'Panth', emailAddress: 'ppanth977@gmail.com' }],
      permissions: [
        { type: 'user', role: 'owner', emailAddress: 'ppanth977@gmail.com' },
        { type: 'user', role: 'commenter', emailAddress: 'Mr.Royal2001@gmail.com' },
        { type: 'anyone', role: 'reader' },
        { type: 'user', role: 'writer', emailAddress: 'gone@x.com', deleted: true },
        { type: 'group', role: 'reader', emailAddress: 'team@x.com' },
      ],
    });
    expect([...m.keys()]).toEqual(['mr.royal2001@gmail.com']);
    expect(m.get('mr.royal2001@gmail.com')).toEqual({ fileId: 'f1', docId: 'd_1', title: 'Zeel & Daivik — Photo Book 2020', role: 'commenter', ownerName: 'Panth', ownerEmail: 'ppanth977@gmail.com' });
  });

  it('a trashed design is shared with nobody', () => {
    expect(inboxFor({ id: 'f', trashed: true, permissions: [{ type: 'user', role: 'writer', emailAddress: 'a@b.com' }] }).size).toBe(0);
  });

  it('only syncs our design files', () => {
    expect(isDesign({ id: 'x', name: 'a.dcanvas' })).toBe(true);
    expect(isDesign({ id: 'x', name: 'photo.jpg', appProperties: { dcDocId: 'd_1' } })).toBe(true);
    expect(isDesign({ id: 'x', name: 'Instructions for photo book.txt' })).toBe(false);
  });
});
