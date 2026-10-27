import { defineApi, endpoint } from '@panth977/icebase/api';
import { f } from '@panth977/icebase/schema';

export const api = defineApi({
  googleSignIn: endpoint({
    tag: 'Account',
    summary: 'Exchange a Google authorization code: signs you in and keeps your Drive connection',
    input: f.map({ code: f.string({ min: 1 }), redirectUri: f.optional(f.string()) }),
    output: f.map({
      token: f.string(),
      driveConnected: f.boolean(),
      accessToken: f.optional(f.string()),
      expiresIn: f.optional(f.number()),
      /** Space-separated scopes Google granted (drive.readonly once the whole Drive is connected). */
      scope: f.optional(f.string()),
    }),
    errors: { 'invalid-argument': 'The code was rejected by Google', 'permission-denied': 'Drive access was not granted' },
    auth: 'none',
  }),
  driveToken: endpoint({
    tag: 'Account',
    summary: 'A fresh Google Drive access token for the signed-in user, on any device',
    input: f.map({}),
    output: f.map({ accessToken: f.string(), expiresIn: f.number(), scope: f.optional(f.string()) }),
    errors: { 'failed-precondition': 'Drive is not connected (sign in again with consent)' },
  }),
});
