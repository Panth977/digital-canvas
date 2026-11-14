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
      /** Space-separated scopes Google granted. */
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
  aiSettings: endpoint({
    tag: 'AI',
    summary: 'Where your AI connector runs tools (your device or our cloud) and which device; optionally change it',
    input: f.map({
      /** Cloud only for allowlisted accounts. */
      processing: f.optional(f.enum(['device', 'cloud'])),
      /** A device id, or '' to let the connector pick the one that is online. */
      activeDevice: f.optional(f.string({ max: 200 })),
    }),
    output: f.map({
      mode: f.enum(['device', 'cloud']),
      requested: f.enum(['device', 'cloud']),
      cloudAllowed: f.boolean(),
      activeDevice: f.optional(f.string()),
    }),
    errors: { 'permission-denied': 'Cloud processing is not available for this account' },
  }),
  syncShares: endpoint({
    tag: 'Sharing',
    summary: 'Refresh the "Shared with you" lists for some of your designs from their Drive permissions',
    // The caller's own Google access token (web or desktop app): the server reads each file's
    // permissions with it, so the lists always match Drive. No Firebase session needed (desktop).
    input: f.map({ accessToken: f.string({ min: 1, max: 4096 }), fileIds: f.array(f.string({ min: 1, max: 200 }), { max: 50 }) }),
    output: f.map({ synced: f.number(), people: f.number() }),
    errors: { unauthenticated: 'The Google token is not valid for Digital Canvas' },
    auth: 'none',
  }),
  sharedWithMe: endpoint({
    tag: 'Sharing',
    summary: 'Designs other people shared with your Google account',
    input: f.map({ accessToken: f.string({ min: 1, max: 4096 }) }),
    output: f.map({
      items: f.array(f.map({
        fileId: f.string(),
        docId: f.optional(f.string()),
        title: f.string(),
        role: f.string(),
        ownerName: f.optional(f.string()),
        ownerEmail: f.optional(f.string()),
        sharedAt: f.string(),
      })),
    }),
    errors: { unauthenticated: 'The Google token is not valid for Digital Canvas' },
    auth: 'none',
  }),
});
