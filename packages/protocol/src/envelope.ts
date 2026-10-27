import { z } from 'zod';
import { MAX_CHANNELS, PAYLOAD_VERSION, SIGNATURE_VERSION } from './limits';

export const messageTypes = ['request', 'response', 'event'] as const;
export type MessageType = (typeof messageTypes)[number];

/** Who caused a state change. Stored in the activity log and sent to devices as clientId. */
export const sources = [
  'app',
  'api',
  'scene',
  'schedule',
  'automation',
  'physical',
  'restore',
  'system',
] as const;
export type Source = (typeof sources)[number];

export const headerSchema = z.object({
  payloadVersion: z.literal(PAYLOAD_VERSION),
  signatureVersion: z.literal(SIGNATURE_VERSION),
});

export const causeSchema = z.object({ type: z.string().max(64) });

export const payloadSchema = z.object({
  action: z.string().min(1).max(64),
  clientId: z.string().max(64),
  /** Unix epoch seconds. */
  createdAt: z.number().int().positive(),
  /** Device id, or the controller key id for controller-level actions. */
  deviceId: z.string().min(1).max(64),
  replyToken: z.string().min(1).max(64),
  type: z.enum(messageTypes),
  value: z.record(z.string(), z.unknown()),
  success: z.boolean().optional(),
  message: z.string().max(256).optional(),
  cause: causeSchema.optional(),
});
export type Payload = z.infer<typeof payloadSchema>;

export const envelopeSchema = z.object({
  header: headerSchema,
  payload: payloadSchema,
  signature: z.object({ HMAC: z.string().min(1).max(128) }),
});
export type Envelope = z.infer<typeof envelopeSchema>;

/** Actions addressed to the controller board itself rather than one of its devices. */
export const controllerActions = {
  /** cloud -> board: deviceId <-> channel mapping and per-channel settings. */
  config: 'config',
  /** cloud -> board: new firmware available. */
  otaUpdateAvailable: 'otaUpdateAvailable',
  /** board -> cloud: OTA progress event. */
  otaStatus: 'otaStatus',
  /** cloud -> board: reboot request. */
  restart: 'restart',
} as const;

export const configValueSchema = z.object({
  channels: z.array(
    z.object({
      channel: z.number().int().min(1),
      deviceId: z.string(),
      type: z.string(),
      powerOnBehavior: z.enum(['off', 'last', 'cloud']).default('last'),
    }),
  ),
});
export type ConfigValue = z.infer<typeof configValueSchema>;

export const otaUpdateValueSchema = z.object({
  url: z.string().url(),
  version: z.string(),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  forceUpdate: z.boolean().default(false),
});

export const otaStatusValueSchema = z.object({
  version: z.string(),
  status: z.enum(['accepted', 'rejected', 'downloading', 'verifying', 'installing', 'failed']),
  progress: z.number().int().min(0).max(100).optional(),
  error: z.string().max(200).optional(),
});

/** Parsed channel declaration from the x-voltix-channels handshake header, e.g. "1:switch,5:fan". */
export function parseChannelsHeader(header: string | undefined): { channel: number; type: string }[] {
  if (!header) return [];
  const out: { channel: number; type: string }[] = [];
  const seen = new Set<number>();
  for (const part of header.split(',')) {
    const m = /^\s*(\d{1,2}):([a-zA-Z][a-zA-Z0-9_-]{0,31})\s*$/.exec(part);
    if (!m) throw new Error(`invalid channel declaration "${part}"`);
    const channel = Number(m[1]);
    if (channel < 1 || channel > MAX_CHANNELS || seen.has(channel)) {
      throw new Error(`invalid or duplicate channel ${channel}`);
    }
    seen.add(channel);
    out.push({ channel, type: m[2]! });
  }
  return out;
}
