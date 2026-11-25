import { randomUUID } from "node:crypto"
import nacl from "tweetnacl"
import { z } from "zod"
import { fromB64, fromUtf8, toB64, utf8 } from "./encoding.js"
import { DuozaProtocolError } from "./errors.js"
import type { Identity, PublicIdentity } from "./identity.js"

const MAX_TEXT = 100_000

export const PayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("msg"), text: z.string().min(1).max(MAX_TEXT) }).strict(),
  z.object({ type: z.literal("query"), queryId: z.string().min(1).max(64), text: z.string().min(1).max(MAX_TEXT) }).strict(),
  z.object({ type: z.literal("query_ack"), queryId: z.string().min(1).max(64), accepted: z.boolean() }).strict(),
  z.object({ type: z.literal("query_result"), queryId: z.string().min(1).max(64), summary: z.string().max(MAX_TEXT) }).strict(),
  z
    .object({
      type: z.literal("handoff"),
      summary: z.string().max(MAX_TEXT),
      branch: z.string().max(256),
      headSha: z.string().max(64),
      diffStat: z.string().max(MAX_TEXT),
      openQuestions: z.array(z.string().max(2_000)).max(50),
    })
    .strict(),
])

export type Payload = z.infer<typeof PayloadSchema>

/** The only thing the relay ever sees. */
export const EnvelopeSchema = z
  .object({
    v: z.literal(1),
    id: z.string().min(1).max(64),
    from: z.string().regex(/^[0-9a-f]{32}$/),
    to: z.string().regex(/^[0-9a-f]{32}$/),
    ts: z.number().int().nonnegative(),
    nonce: z.string().min(1),
    ciphertext: z.string().min(1),
  })
  .strict()

export type Envelope = z.infer<typeof EnvelopeSchema>

interface Header {
  id: string
  from: string
  to: string
  ts: number
}

const InnerSchema = z
  .object({
    h: z.object({ id: z.string(), from: z.string(), to: z.string(), ts: z.number() }).strict(),
    p: z.unknown(),
  })
  .strict()

export interface SealInput {
  sender: Identity
  recipient: PublicIdentity
  payload: Payload
  id?: string
  ts?: number
}

/**
 * Encrypts and authenticates a payload for one recipient (NaCl box: X25519 + XSalsa20-Poly1305).
 * The header is copied inside the ciphertext so the relay can't re-address or re-stamp it.
 */
export function sealEnvelope(input: SealInput): Envelope {
  const parsed = PayloadSchema.safeParse(input.payload)
  if (!parsed.success) {
    throw new DuozaProtocolError("invalid_payload", parsed.error.message)
  }
  const header: Header = {
    id: input.id ?? randomUUID(),
    from: input.sender.deviceId,
    to: input.recipient.deviceId,
    ts: input.ts ?? Date.now(),
  }
  const nonce = nacl.randomBytes(nacl.box.nonceLength)
  const plaintext = utf8(JSON.stringify({ h: header, p: parsed.data }))
  const ciphertext = nacl.box(plaintext, nonce, fromB64(input.recipient.boxPublicKey), fromB64(input.sender.boxSecretKey))
  return { v: 1, ...header, nonce: toB64(nonce), ciphertext: toB64(ciphertext) }
}

export interface OpenInput {
  envelope: unknown
  me: Identity
  /** The paired peer this envelope claims to come from, looked up by envelope.from. */
  sender: PublicIdentity
}

export function openEnvelope(input: OpenInput): Payload {
  const env = EnvelopeSchema.safeParse(input.envelope)
  if (!env.success) {
    throw new DuozaProtocolError("invalid_envelope", env.error.message)
  }
  const envelope = env.data
  if (envelope.to !== input.me.deviceId) {
    throw new DuozaProtocolError("wrong_recipient", "envelope is not addressed to this device")
  }
  if (envelope.from !== input.sender.deviceId) {
    throw new DuozaProtocolError("header_mismatch", "envelope sender does not match the expected peer")
  }
  const plaintext = nacl.box.open(fromB64(envelope.ciphertext), fromB64(envelope.nonce), fromB64(input.sender.boxPublicKey), fromB64(input.me.boxSecretKey))
  if (plaintext === null) {
    throw new DuozaProtocolError("decrypt_failed", "ciphertext failed authentication")
  }
  let inner: z.infer<typeof InnerSchema>
  try {
    inner = InnerSchema.parse(JSON.parse(fromUtf8(plaintext)))
  } catch {
    throw new DuozaProtocolError("invalid_payload", "decrypted content is malformed")
  }
  const { h } = inner
  if (h.id !== envelope.id || h.from !== envelope.from || h.to !== envelope.to || h.ts !== envelope.ts) {
    throw new DuozaProtocolError("header_mismatch", "outer header differs from the sealed header")
  }
  const payload = PayloadSchema.safeParse(inner.p)
  if (!payload.success) {
    throw new DuozaProtocolError("invalid_payload", payload.error.message)
  }
  return payload.data
}
