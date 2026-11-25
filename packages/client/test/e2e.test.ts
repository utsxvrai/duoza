import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { generateIdentity, sealEnvelope, toPublicIdentity } from "@duoza/protocol"
import { buildRelay, SqliteStore } from "@duoza/relay"
import type { FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { DuozaEvent } from "../src/core.js"
import { Duoza } from "../src/core.js"
import { DuozaClientError } from "../src/errors.js"
import type { RelayConnection } from "../src/relay-connection.js"
import { LocalStore } from "../src/store.js"

let app: FastifyInstance
let relayStore: SqliteStore
let relayUrl: string
const listeners: RelayConnection[] = []

interface Side {
  duoza: Duoza
  store: LocalStore
  events: DuozaEvent[]
  next: (pred: (e: DuozaEvent) => boolean) => Promise<DuozaEvent>
}

async function side(opts: { listen: boolean }): Promise<Side> {
  const store = new LocalStore(mkdtempSync(join(tmpdir(), "duoza-e2e-")))
  const duoza = new Duoza({ store, relayUrl })
  const events: DuozaEvent[] = []
  if (opts.listen) {
    listeners.push(
      await duoza.listen((e) => {
        events.push(e)
      }),
    )
  }
  const next = async (pred: (e: DuozaEvent) => boolean): Promise<DuozaEvent> => {
    const deadline = Date.now() + 2000
    for (;;) {
      const hit = events.find(pred)
      if (hit !== undefined) return hit
      if (Date.now() > deadline) throw new Error(`no matching event; got ${JSON.stringify(events)}`)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  return { duoza, store, events, next }
}

async function pairUp(): Promise<{ utsav: Side; priyanshi: Side }> {
  const utsav = await side({ listen: true })
  const priyanshi = await side({ listen: true })
  const { code } = await utsav.duoza.request("Priyanshi")
  await priyanshi.duoza.pair("Utsav", code)
  await utsav.next((e) => e.kind === "paired")
  return { utsav, priyanshi }
}

beforeEach(async () => {
  relayStore = new SqliteStore(":memory:")
  app = buildRelay({ store: relayStore })
  await app.listen({ port: 0, host: "127.0.0.1" })
  const address = app.server.address()
  if (address === null || typeof address === "string") throw new Error("no port")
  relayUrl = `http://127.0.0.1:${address.port}`
})

afterEach(async () => {
  await Promise.all(
    listeners.splice(0).map(async (l) => {
      await l.close()
    }),
  )
  await app.close()
  relayStore.close()
})

describe("duoza end to end (two people, one relay)", () => {
  it("pairs with a code and both sides see the same emoji fingerprint", async () => {
    const utsav = await side({ listen: true })
    const priyanshi = await side({ listen: true })
    const { code } = await utsav.duoza.request("Priyanshi")
    expect(code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/)

    const theirs = await priyanshi.duoza.pair("Utsav", code)
    const mine = await utsav.next((e) => e.kind === "paired")
    expect(mine).toEqual({ kind: "paired", name: "Priyanshi", fingerprint: theirs.fingerprint })
    expect(theirs.fingerprint).toHaveLength(4)
    expect(utsav.store.findPeer("Priyanshi")).not.toBeNull()
    expect(priyanshi.store.findPeer("Utsav")).not.toBeNull()
  })

  it("delivers a chat message, labelled with the sender's local nickname", async () => {
    const { utsav, priyanshi } = await pairUp()
    await utsav.duoza.send("priyanshi", "kal ka bug fix ho gaya")
    expect(await priyanshi.next((e) => e.kind === "msg")).toEqual({ kind: "msg", from: "Utsav", text: "kal ka bug fix ho gaya" })
  })

  it("query: the receiver gets a notice without the text; accept reveals it, acks, and the result flows back", async () => {
    const { utsav, priyanshi } = await pairUp()
    const { queryId } = await utsav.duoza.query("Priyanshi", "auth ke tests chala")

    const notice = await priyanshi.next((e) => e.kind === "query_pending")
    expect(notice).toEqual({ kind: "query_pending", from: "Utsav", number: 1 })
    expect(JSON.stringify(notice)).not.toContain("auth ke tests")

    expect(priyanshi.duoza.show(1)).toMatchObject({ text: "auth ke tests chala", state: "pending", fromName: "Utsav" })

    const accepted = await priyanshi.duoza.accept(1)
    expect(accepted).toMatchObject({ text: "auth ke tests chala", queryId, fromName: "Utsav" })
    expect(await utsav.next((e) => e.kind === "query_ack")).toEqual({
      kind: "query_ack",
      from: "Priyanshi",
      queryId,
      accepted: true,
      text: "auth ke tests chala",
    })

    await expect(priyanshi.duoza.accept(1)).rejects.toThrow(DuozaClientError)

    await priyanshi.duoza.result(queryId, "3 tests fail: token expiry")
    expect(await utsav.next((e) => e.kind === "query_result")).toEqual({
      kind: "query_result",
      from: "Priyanshi",
      queryId,
      summary: "3 tests fail: token expiry",
      text: "auth ke tests chala",
    })
  })

  it("reject tells the sender and the query can't be accepted afterwards", async () => {
    const { utsav, priyanshi } = await pairUp()
    const { queryId } = await utsav.duoza.query("Priyanshi", "rm -rf node_modules")
    await priyanshi.next((e) => e.kind === "query_pending")
    await priyanshi.duoza.reject(1)
    expect(await utsav.next((e) => e.kind === "query_ack")).toMatchObject({ queryId, accepted: false })
    await expect(priyanshi.duoza.accept(1)).rejects.toThrow(DuozaClientError)
  })

  it("a message sent while the receiver is offline arrives when they start listening", async () => {
    const utsav = await side({ listen: true })
    const priyanshiStore = new LocalStore(mkdtempSync(join(tmpdir(), "duoza-e2e-")))
    const priyanshiOffline = new Duoza({ store: priyanshiStore, relayUrl })
    const { code } = await utsav.duoza.request("Priyanshi")
    await priyanshiOffline.pair("Utsav", code)
    await utsav.next((e) => e.kind === "paired")
    await utsav.duoza.send("Priyanshi", "jab online aao tab padhna")

    const events: DuozaEvent[] = []
    listeners.push(
      await priyanshiOffline.listen((e) => {
        events.push(e)
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(events).toContainEqual({ kind: "msg", from: "Utsav", text: "jab online aao tab padhna" })
  })

  it("a CLI-style send doesn't disconnect the sender's own listener", async () => {
    const { utsav, priyanshi } = await pairUp()
    await utsav.duoza.send("Priyanshi", "one")
    await utsav.duoza.send("Priyanshi", "two")
    await priyanshi.duoza.send("Utsav", "still there?")
    expect(await utsav.next((e) => e.kind === "msg")).toMatchObject({ text: "still there?" })
  })

  it("the same envelope delivered twice produces one event", async () => {
    const { utsav, priyanshi } = await pairUp()
    const me = utsav.store.loadOrCreateIdentity()
    const them = priyanshi.store.loadOrCreateIdentity()
    const envelope = sealEnvelope({ sender: me, recipient: toPublicIdentity(them), payload: { type: "msg", text: "once" } })
    expect(await priyanshi.duoza.handleDelivery({ kind: "envelope", envelope })).toMatchObject({ kind: "msg" })
    expect(await priyanshi.duoza.handleDelivery({ kind: "envelope", envelope })).toBeNull()
  })

  it("drops envelopes from devices it never paired with", async () => {
    const { priyanshi } = await pairUp()
    const stranger = generateIdentity()
    const them = priyanshi.store.loadOrCreateIdentity()
    const envelope = sealEnvelope({ sender: stranger, recipient: toPublicIdentity(them), payload: { type: "msg", text: "spam" } })
    expect(await priyanshi.duoza.handleDelivery({ kind: "envelope", envelope })).toBeNull()
  })

  it("unknown peer names fail with a clear error", async () => {
    const utsav = await side({ listen: false })
    await expect(utsav.duoza.send("Nobody", "hi")).rejects.toMatchObject({ code: "unknown_peer" })
  })

  it("explains when the peer exists only as a code you handed out", async () => {
    const utsav = await side({ listen: false })
    await utsav.duoza.request("Priyanshi")
    await expect(utsav.duoza.send("Priyanshi", "hi")).rejects.toThrow(/hasn't used your code yet/)
  })

  it("peers shows presence; unpair removes the peer on both sides", async () => {
    const { utsav, priyanshi } = await pairUp()
    expect(await utsav.duoza.peers()).toEqual([expect.objectContaining({ name: "Priyanshi", status: "online" })])
    await utsav.duoza.unpair("Priyanshi")
    expect(utsav.store.findPeer("Priyanshi")).toBeNull()
    expect(await priyanshi.next((e) => e.kind === "unpaired")).toEqual({ kind: "unpaired", name: "Utsav" })
    expect(priyanshi.store.findPeer("Utsav")).toBeNull()
  })
})
