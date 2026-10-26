import { collection, defineSchema, f, index } from '@panth977/icebase/schema';

/** One doc per account. The backend keeps almost nothing: who you are and how often you sign in. */
export const users = collection('users', {
  fields: {
    email: f.string(),
    name: f.string(),
    photo: f.optional(f.string()),
    loginCount: f.number(),
    createdAt: f.timestamp(),
    lastLogin: f.timestamp(),
  },
  indexes: [index('email')],
});

/** The Drive connection: an encrypted refresh token. Only functions read or write it. */
export const drive = collection('users/{uid}/private', {
  fields: {
    refreshToken: f.string(),
    scope: f.string(),
    updatedAt: f.timestamp(),
  },
  indexes: [],
});

export const schema = defineSchema({ users, drive });
