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
    /** Where AI tool calls run (functions write it: aiSettings). Cloud only for allowlisted accounts. */
    processing: f.optional(f.enum(['device', 'cloud'])),
    /** The device AI tool calls go to (aiSettings, or the agent's use_device). */
    activeDevice: f.optional(f.string()),
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

/**
 * Device bridge (packages/mcp/src/bridge): the user's devices that run AI tool
 * calls. Each device writes its own doc (heartbeat in lastSeen, server time).
 */
export const devices = collection('users/{uid}/devices', {
  fields: {
    name: f.string({ max: 80 }),
    platform: f.string({ max: 20 }),
    /** "Let AI use this device" is on. */
    enabled: f.boolean(),
    lastSeen: f.timestamp(),
    appVersion: f.optional(f.string({ max: 40 })),
  },
  indexes: [],
});

/** Tool calls for a device: created by the MCP relay (functions), answered by the device, deleted by the relay. */
export const bridgeJobs = collection('users/{uid}/bridgeJobs', {
  fields: {
    device: f.string(),
    tool: f.string(),
    /** JSON of the arguments. */
    args: f.string(),
    state: f.enum(['pending', 'running', 'done', 'failed', 'cancelled']),
    createdAt: f.timestamp(),
    expiresAt: f.timestamp(),
    startedAt: f.optional(f.timestamp()),
    finishedAt: f.optional(f.timestamp()),
    /** JSON of the tool result (≤ 900 KB), or `parts` documents. */
    result: f.optional(f.string()),
    parts: f.optional(f.number({ int: true, min: 1 })),
    error: f.optional(f.string()),
  },
  indexes: [index('device')],
  ttl: 'expiresAt',
});

/** A large tool result, in order (`{n}` = 0, 1, …). */
export const bridgeParts = collection('users/{uid}/bridgeJobs/{jobId}/parts', {
  fields: { data: f.string(), expiresAt: f.timestamp() },
  indexes: [],
  ttl: 'expiresAt',
});

export const schema = defineSchema({ users, drive, devices, bridgeJobs, bridgeParts });
