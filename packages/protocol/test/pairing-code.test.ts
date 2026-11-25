import { describe, expect, it } from "vitest"
import { generatePairingCode, normalizePairingCode, PAIRING_ALPHABET } from "../src/pairing-code.js"

describe("pairing code", () => {
  it("has the XXX-XXX shape and only unambiguous characters", () => {
    for (let i = 0; i < 500; i++) {
      const code = generatePairingCode()
      expect(code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/)
      for (const ch of code.replace("-", "")) {
        expect(PAIRING_ALPHABET).toContain(ch)
      }
    }
  })

  it("never uses look-alike characters", () => {
    for (const ch of ["0", "O", "1", "I", "L"]) {
      expect(PAIRING_ALPHABET).not.toContain(ch)
    }
  })

  it("is not constant", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generatePairingCode()))
    expect(codes.size).toBeGreaterThan(45)
  })

  it("normalizes what a person types (case, spaces, dash)", () => {
    expect(normalizePairingCode("k7p-42q")).toBe("K7P42Q")
    expect(normalizePairingCode(" K7P 42Q ")).toBe("K7P42Q")
    expect(normalizePairingCode("K7P42Q")).toBe("K7P42Q")
  })

  it("rejects malformed codes", () => {
    expect(normalizePairingCode("")).toBeNull()
    expect(normalizePairingCode("K7P-42")).toBeNull()
    expect(normalizePairingCode("K7P-42QQ")).toBeNull()
    expect(normalizePairingCode("K0P-42Q")).toBeNull()
    expect(normalizePairingCode("K7P;rm -rf")).toBeNull()
  })
})
