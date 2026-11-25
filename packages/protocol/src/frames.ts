import { z } from "zod"
import { EnvelopeSchema } from "./envelope.js"
import { deviceIdFor } from "./identity.js"

const DeviceId = z.string().regex(/^[0-9a-f]{32}$/)
const Key = z.string().min(40).max(64)

/** A public identity whose deviceId really is derived from its signing key. */
export const PublicIdentitySchema = z
  .object({
    deviceId: DeviceId,
    signPublicKey: Key,
    boxPublicKey: Key,
  })
  .strict()
  .refine(
    (id) => {
      try {
        return deviceIdFor(id.signPublicKey) === id.deviceId
      } catch {
        return false
      }
    },
    { message: "deviceId does not match signPublicKey" },
  )

// ---- HTTP bodies -----------------------------------------------------------

export const PairStartBodySchema = z.object({ identity: PublicIdentitySchema }).strict()
export const PairClaimBodySchema = z.object({ code: z.string().min(1).max(32), identity: PublicIdentitySchema }).strict()

// ---- WebSocket frames: client -> relay -------------------------------------

export const ClientFrameSchema = z.discriminatedUnion("t", [
  z
    .object({
      t: z.literal("auth"),
      identity: PublicIdentitySchema,
      sig: z.string().min(1),
      // "send_only": a short-lived CLI connection. It doesn't replace the device's
      // long-lived listener, receive mail, or change presence.
      mode: z.enum(["listen", "send_only"]).optional(),
    })
    .strict(),
  z.object({ t: z.literal("send"), ref: z.string().min(1).max(64), envelope: EnvelopeSchema }).strict(),
  z.object({ t: z.literal("ack"), seq: z.number().int().positive() }).strict(),
  z.object({ t: z.literal("status"), status: z.enum(["online", "busy"]) }).strict(),
  z.object({ t: z.literal("presence_query") }).strict(),
  z.object({ t: z.literal("unpair"), peer: DeviceId }).strict(),
])

export type ClientFrame = z.infer<typeof ClientFrameSchema>

// ---- WebSocket frames: relay -> client -------------------------------------

export type PresenceStatus = "online" | "busy" | "offline"

/** Things the relay queues for a device until it acks them. */
export type Delivery =
  | { kind: "envelope"; envelope: z.infer<typeof EnvelopeSchema> }
  | { kind: "pair_claimed"; code: string; peer: z.infer<typeof PublicIdentitySchema> }
  | { kind: "unpaired"; peer: string }

export type RelayErrorCode = "bad_frame" | "auth_failed" | "key_conflict" | "forbidden" | "not_paired" | "mailbox_full" | "rate_limited"

export type ServerFrame =
  | { t: "challenge"; nonce: string }
  | { t: "ready"; deviceId: string }
  | { t: "deliver"; seq: number; delivery: Delivery }
  | { t: "sent"; ref: string; id: string }
  | { t: "presence"; deviceId: string; status: PresenceStatus }
  | { t: "presence_state"; peers: Array<{ deviceId: string; status: PresenceStatus }> }
  | { t: "error"; code: RelayErrorCode; ref?: string; message: string }

/** WebSocket close codes the relay uses. */
export const CloseCode = {
  replaced: 4000,
  authFailed: 4401,
  authTimeout: 4408,
  tooManyConnections: 4429,
} as const
