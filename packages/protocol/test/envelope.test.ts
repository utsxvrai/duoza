import { describe, expect, it } from "vitest"
import { fromB64, toB64 } from "../src/encoding.js"
import type { Payload } from "../src/envelope.js"
import { EnvelopeSchema, openEnvelope, sealEnvelope } from "../src/envelope.js"
import { DuozaProtocolError } from "../src/errors.js"
import { generateIdentity, toPublicIdentity } from "../src/identity.js"

const utsav = generateIdentity()
const priyanshi = generateIdentity()
const eve = generateIdentity()

const msg: Payload = { type: "msg", text: "kal ka bug fix ho gaya" }

function expectProtocolError(fn: () => unknown, code: string): void {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(DuozaProtocolError)
    expect((err as DuozaProtocolError).code).toBe(code)
    return
  }
  throw new Error(`expected DuozaProtocolError(${code})`)
}

describe("seal/open", () => {
  it("round-trips every payload type", () => {
    const payloads: Payload[] = [
      msg,
      { type: "query", queryId: "q1", text: "auth ke tests chala" },
      { type: "query_ack", queryId: "q1", accepted: true },
      { type: "query_result", queryId: "q1", summary: "3 tests fail" },
      { type: "handoff", summary: "s", branch: "main", headSha: "abc123", diffStat: "1 file", openQuestions: ["x?"] },
    ]
    for (const payload of payloads) {
      const env = sealEnvelope({ sender: utsav, recipient: toPublicIdentity(priyanshi), payload })
      expect(EnvelopeSchema.parse(env)).toEqual(env)
      const opened = openEnvelope({ envelope: env, me: priyanshi, sender: toPublicIdentity(utsav) })
      expect(opened).toEqual(payload)
    }
  })

  it("the relay-visible envelope does not contain the plaintext", () => {
    const env = sealEnvelope({ sender: utsav, recipient: toPublicIdentity(priyanshi), payload: msg })
    expect(JSON.stringify(env)).not.toContain("bug fix")
    expect(env.from).toBe(utsav.deviceId)
    expect(env.to).toBe(priyanshi.deviceId)
  })

  it("rejects a tampered ciphertext", () => {
    const env = sealEnvelope({ sender: utsav, recipient: toPublicIdentity(priyanshi), payload: msg })
    const bytes = fromB64(env.ciphertext)
    bytes[0] = (bytes[0] ?? 0) ^ 0xff
    expectProtocolError(
      () => openEnvelope({ envelope: { ...env, ciphertext: toB64(bytes) }, me: priyanshi, sender: toPublicIdentity(utsav) }),
      "decrypt_failed",
    )
  })

  it("rejects an envelope the relay re-addressed or re-stamped", () => {
    const env = sealEnvelope({ sender: utsav, recipient: toPublicIdentity(priyanshi), payload: msg })
    expectProtocolError(() => openEnvelope({ envelope: { ...env, id: "other-id" }, me: priyanshi, sender: toPublicIdentity(utsav) }), "header_mismatch")
    expectProtocolError(() => openEnvelope({ envelope: { ...env, ts: env.ts + 1 }, me: priyanshi, sender: toPublicIdentity(utsav) }), "header_mismatch")
  })

  it("rejects a message forged by a third party claiming to be Utsav", () => {
    const forged = sealEnvelope({ sender: eve, recipient: toPublicIdentity(priyanshi), payload: msg })
    const relabelled = { ...forged, from: utsav.deviceId }
    expectProtocolError(() => openEnvelope({ envelope: relabelled, me: priyanshi, sender: toPublicIdentity(utsav) }), "decrypt_failed")
  })

  it("rejects an envelope addressed to someone else", () => {
    const env = sealEnvelope({ sender: utsav, recipient: toPublicIdentity(eve), payload: msg })
    expectProtocolError(() => openEnvelope({ envelope: env, me: priyanshi, sender: toPublicIdentity(utsav) }), "wrong_recipient")
  })

  it("rejects a valid-crypto envelope whose payload has an unknown type", () => {
    const bogus = { type: "rm_rf", text: "x" } as unknown as Payload
    expectProtocolError(() => sealEnvelope({ sender: utsav, recipient: toPublicIdentity(priyanshi), payload: bogus }), "invalid_payload")
  })

  it("uses a fresh nonce and id per envelope", () => {
    const a = sealEnvelope({ sender: utsav, recipient: toPublicIdentity(priyanshi), payload: msg })
    const b = sealEnvelope({ sender: utsav, recipient: toPublicIdentity(priyanshi), payload: msg })
    expect(a.nonce).not.toBe(b.nonce)
    expect(a.id).not.toBe(b.id)
  })
})
