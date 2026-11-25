import { describe, expect, it } from "vitest"
import { toB64 } from "../src/encoding.js"
import { fingerprint } from "../src/fingerprint.js"
import { deviceIdFor, generateIdentity, signChallenge, toPublicIdentity, verifyChallenge } from "../src/identity.js"

describe("identity", () => {
  it("generates distinct identities with a deviceId derived from the signing key", () => {
    const a = generateIdentity()
    const b = generateIdentity()
    expect(a.deviceId).not.toBe(b.deviceId)
    expect(a.deviceId).toBe(deviceIdFor(a.signPublicKey))
    expect(a.deviceId).toMatch(/^[0-9a-f]{32}$/)
  })

  it("public identity never carries secret keys", () => {
    const pub = toPublicIdentity(generateIdentity())
    expect(Object.keys(pub).sort()).toEqual(["boxPublicKey", "deviceId", "signPublicKey"])
  })

  it("signs and verifies a relay challenge", () => {
    const me = generateIdentity()
    const other = generateIdentity()
    const challenge = toB64(new Uint8Array(32).fill(7))
    const sig = signChallenge(me, challenge)
    expect(verifyChallenge(me.signPublicKey, challenge, sig)).toBe(true)
    expect(verifyChallenge(other.signPublicKey, challenge, sig)).toBe(false)
    expect(verifyChallenge(me.signPublicKey, toB64(new Uint8Array(32).fill(8)), sig)).toBe(false)
  })

  it("verifyChallenge returns false (not throws) on garbage input", () => {
    expect(verifyChallenge("not-base64!!", "also bad", "nope")).toBe(false)
  })
})

describe("fingerprint", () => {
  it("is 4 emoji, identical on both sides regardless of argument order", () => {
    const a = generateIdentity()
    const b = generateIdentity()
    const ab = fingerprint(a.signPublicKey, b.signPublicKey)
    const ba = fingerprint(b.signPublicKey, a.signPublicKey)
    expect(ab).toHaveLength(4)
    expect(ab).toEqual(ba)
  })

  it("changes when either key changes (a MITM would show different emoji)", () => {
    const a = generateIdentity()
    const b = generateIdentity()
    const mitm = generateIdentity()
    expect(fingerprint(a.signPublicKey, b.signPublicKey)).not.toEqual(fingerprint(a.signPublicKey, mitm.signPublicKey))
  })
})
