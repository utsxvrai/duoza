import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { generateIdentity, toPublicIdentity } from "@duoza/protocol"
import { describe, expect, it } from "vitest"
import { Duoza } from "../src/core.js"
import { LocalStore } from "../src/store.js"

function withPeers(...names: string[]): Duoza {
  const store = new LocalStore(mkdtempSync(join(tmpdir(), "duoza-split-")))
  for (const n of names) store.addPeer(n, toPublicIdentity(generateIdentity()), 1)
  return new Duoza({ store, relayUrl: "http://127.0.0.1:9" })
}

describe("splitTarget", () => {
  it("matches a multi-word name against paired people, longest name first", () => {
    const d = withPeers("Gaurav", "Gaurav_Sir")
    expect(d.splitTarget("Gaurav Sir tests chala do")).toEqual({ name: "Gaurav_Sir", text: "tests chala do" })
    expect(d.splitTarget("Gaurav tests chala do")).toEqual({ name: "Gaurav", text: "tests chala do" })
    expect(d.splitTarget("gaurav_sir hi")).toEqual({ name: "Gaurav_Sir", text: "hi" })
  })

  it("keeps the message's own spacing and line breaks", () => {
    const d = withPeers("Gaurav_Sir")
    expect(d.splitTarget("Gaurav Sir line one\n  line two")).toEqual({ name: "Gaurav_Sir", text: "line one\n  line two" })
  })

  it("with several people, an unknown name falls back to the first word, so the error names it", () => {
    const d = withPeers("Gaurav_Sir", "Priyanshi")
    expect(d.splitTarget("Rahul hello")).toEqual({ name: "Rahul", text: "hello" })
  })

  it("with exactly one person, the name is optional", () => {
    const d = withPeers("Gaurav_Sir")
    expect(d.splitTarget("fix push ho gaya")).toEqual({ name: "Gaurav_Sir", text: "fix push ho gaya" })
    expect(d.splitTarget("Gaurav Sir fix push ho gaya")).toEqual({ name: "Gaurav_Sir", text: "fix push ho gaya" })
    expect(d.resolvePeerName()).toBe("Gaurav_Sir")
  })

  it("with several people and no name, asks who", () => {
    const d = withPeers("Gaurav_Sir", "Priyanshi")
    expect(() => d.splitTarget("hello")).toThrow(/who should get it\? .*Gaurav_Sir, Priyanshi/)
    expect(() => d.resolvePeerName()).toThrow(/who should get it/)
  })

  it("a name with no message is a usage error", () => {
    const d = withPeers("Gaurav_Sir")
    expect(() => d.splitTarget("Gaurav Sir")).toThrow(/message/)
  })
})
