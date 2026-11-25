import { mkdtempSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { generateIdentity, toPublicIdentity } from "@duoza/protocol"
import { describe, expect, it } from "vitest"
import { DuozaClientError } from "../src/errors.js"
import { LocalStore } from "../src/store.js"

function freshHome(): string {
  return mkdtempSync(join(tmpdir(), "duoza-store-"))
}

describe("LocalStore", () => {
  it("creates an identity once, keeps it private, and reloads the same one", () => {
    const home = freshHome()
    const a = new LocalStore(home).loadOrCreateIdentity()
    const b = new LocalStore(home).loadOrCreateIdentity()
    expect(b).toEqual(a)
    expect(statSync(join(home, "identity.json")).mode & 0o777).toBe(0o600)
    expect(statSync(home).mode & 0o777).toBe(0o700)
  })

  it("stores peers by nickname, case-insensitively, and refuses duplicates", () => {
    const store = new LocalStore(freshHome())
    const p = toPublicIdentity(generateIdentity())
    store.addPeer("Priyanshi", p, 1)
    expect(store.findPeer("priyanshi")?.identity).toEqual(p)
    expect(store.findPeerByDevice(p.deviceId)?.name).toBe("Priyanshi")
    expect(() => {
      store.addPeer("PRIYANSHI", toPublicIdentity(generateIdentity()), 2)
    }).toThrow(DuozaClientError)
    expect(() => {
      store.addPeer("Other", p, 2)
    }).toThrow(DuozaClientError)
    store.removePeer("Priyanshi")
    expect(store.findPeer("Priyanshi")).toBeNull()
  })

  it("rejects nicknames that aren't simple words", () => {
    const store = new LocalStore(freshHome())
    const p = toPublicIdentity(generateIdentity())
    for (const bad of ["", "a b", "x;rm", "a".repeat(33), "../etc"]) {
      expect(() => {
        store.addPeer(bad, p, 1)
      }).toThrow(DuozaClientError)
    }
    store.addPeer("प्रियांशी", p, 1)
    expect(store.findPeer("प्रियांशी")).not.toBeNull()
  })

  it("pending pair codes are consumed once and expire", () => {
    const store = new LocalStore(freshHome())
    store.addPendingPair("K7P42Q", "Priyanshi", 100)
    expect(store.takePendingPair("K7P42Q", 50)).toBe("Priyanshi")
    expect(store.takePendingPair("K7P42Q", 50)).toBeNull()
    store.addPendingPair("AAAAAA", "Late", 100)
    expect(store.takePendingPair("AAAAAA", 101)).toBeNull()
  })

  it("numbers inbound queries 1, 2, 3 and tracks their state", () => {
    const store = new LocalStore(freshHome())
    const from = generateIdentity().deviceId
    const n1 = store.addInboundQuery({ queryId: "q-a", from, text: "one", receivedAt: 1 })
    const n2 = store.addInboundQuery({ queryId: "q-b", from, text: "two", receivedAt: 2 })
    expect([n1, n2]).toEqual([1, 2])
    expect(store.getInboundQuery(2)?.text).toBe("two")
    store.setInboundQueryState(2, "accepted")
    expect(store.getInboundQuery(2)?.state).toBe("accepted")
    expect(store.findInboundQueryById("q-a")?.number).toBe(1)
  })

  it("remembers which envelope ids it has already handled", () => {
    const store = new LocalStore(freshHome())
    expect(store.markSeen("e1")).toBe(true)
    expect(store.markSeen("e1")).toBe(false)
  })
})
