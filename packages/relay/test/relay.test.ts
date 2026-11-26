import type { Identity, ServerFrame } from "@duoza/protocol"
import { CloseCode, generateIdentity, sealEnvelope, toPublicIdentity } from "@duoza/protocol"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import WebSocket from "ws"
import type { TestRelay } from "./helpers.js"
import { postJson, startRelay, TestDevice } from "./helpers.js"

let relay: TestRelay
const open: TestDevice[] = []

async function connect(identity: Identity, opts: { badSignature?: boolean } = {}): Promise<TestDevice> {
  const d = await TestDevice.connect(relay.wsUrl, identity, opts)
  open.push(d)
  return d
}

async function connectReady(identity: Identity): Promise<TestDevice> {
  const d = await connect(identity)
  await d.waitFor((f) => f.t === "ready")
  return d
}

async function pair(a: Identity, b: Identity): Promise<void> {
  const start = await postJson(`${relay.url}/v1/pair/start`, { identity: toPublicIdentity(a) })
  const { code } = start.body as { code: string }
  const claim = await postJson(`${relay.url}/v1/pair/claim`, { code, identity: toPublicIdentity(b) })
  expect(claim.status).toBe(200)
}

const isDeliver = (f: ServerFrame): f is Extract<ServerFrame, { t: "deliver" }> => f.t === "deliver"

beforeEach(async () => {
  relay = await startRelay()
})

afterEach(async () => {
  await Promise.all(open.splice(0).map(async (d) => await d.close()))
  await relay.close()
})

describe("health", () => {
  it("responds", async () => {
    const res = await fetch(`${relay.url}/health`)
    expect(res.status).toBe(200)
  })
})

describe("display names", () => {
  it("each side's chosen name travels to the other during pairing", async () => {
    const utsav = generateIdentity()
    const gaurav = generateIdentity()
    const utsavWs = await connectReady(utsav)
    const start = await postJson(`${relay.url}/v1/pair/start`, { identity: toPublicIdentity(utsav), displayName: "Utsav" })
    const { code } = start.body as { code: string }
    const claim = await postJson(`${relay.url}/v1/pair/claim`, { code, identity: toPublicIdentity(gaurav), displayName: "Gaurav_Sir" })
    expect(claim.status).toBe(200)
    expect(claim.body).toEqual({ peer: toPublicIdentity(utsav), displayName: "Utsav" })
    const frame = await utsavWs.waitFor(isDeliver)
    expect(frame).toMatchObject({ delivery: { kind: "pair_claimed", displayName: "Gaurav_Sir" } })
  })

  it("names are optional (older clients) and must be a single safe word", async () => {
    const ok = await postJson(`${relay.url}/v1/pair/start`, { identity: toPublicIdentity(generateIdentity()) })
    expect(ok.status).toBe(200)
    for (const bad of ["Gaurav Sir", "x‮", "", "a".repeat(33)]) {
      const res = await postJson(`${relay.url}/v1/pair/start`, { identity: toPublicIdentity(generateIdentity()), displayName: bad })
      expect(res.status).toBe(400)
    }
  })
})

describe("pairing", () => {
  it("start returns a readable code; claim returns the initiator's public identity", async () => {
    const utsav = generateIdentity()
    const priyanshi = generateIdentity()
    const start = await postJson(`${relay.url}/v1/pair/start`, { identity: toPublicIdentity(utsav) })
    expect(start.status).toBe(200)
    const { code, expiresAt } = start.body as { code: string; expiresAt: number }
    expect(code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/)
    expect(expiresAt).toBe(relay.clock.now + 10 * 60_000)

    const claim = await postJson(`${relay.url}/v1/pair/claim`, { code: code.toLowerCase(), identity: toPublicIdentity(priyanshi) })
    expect(claim.status).toBe(200)
    expect(claim.body).toEqual({ peer: toPublicIdentity(utsav) })
  })

  it("tells an online initiator that the code was claimed", async () => {
    const utsav = generateIdentity()
    const priyanshi = generateIdentity()
    const utsavWs = await connectReady(utsav)
    await pair(utsav, priyanshi)
    const frame = await utsavWs.waitFor(isDeliver)
    expect(frame).toMatchObject({ t: "deliver", delivery: { kind: "pair_claimed", peer: toPublicIdentity(priyanshi) } })
    if (!isDeliver(frame) || frame.delivery.kind !== "pair_claimed") throw new Error("unreachable")
    expect(frame.delivery.code).toMatch(/^[A-Z2-9]{6}$/)
  })

  it("queues the pair_claimed notice for an offline initiator", async () => {
    const utsav = generateIdentity()
    const priyanshi = generateIdentity()
    await pair(utsav, priyanshi)
    const utsavWs = await connectReady(utsav)
    const frame = await utsavWs.waitFor(isDeliver)
    expect(frame).toMatchObject({ delivery: { kind: "pair_claimed" } })
  })

  it("a code works only once", async () => {
    const utsav = generateIdentity()
    const start = await postJson(`${relay.url}/v1/pair/start`, { identity: toPublicIdentity(utsav) })
    const { code } = start.body as { code: string }
    expect((await postJson(`${relay.url}/v1/pair/claim`, { code, identity: toPublicIdentity(generateIdentity()) })).status).toBe(200)
    expect((await postJson(`${relay.url}/v1/pair/claim`, { code, identity: toPublicIdentity(generateIdentity()) })).status).toBe(404)
  })

  it("a code expires after 10 minutes", async () => {
    const start = await postJson(`${relay.url}/v1/pair/start`, { identity: toPublicIdentity(generateIdentity()) })
    const { code } = start.body as { code: string }
    relay.clock.now += 10 * 60_000 + 1
    expect((await postJson(`${relay.url}/v1/pair/claim`, { code, identity: toPublicIdentity(generateIdentity()) })).status).toBe(404)
  })

  it("you can't pair with yourself", async () => {
    const utsav = generateIdentity()
    const start = await postJson(`${relay.url}/v1/pair/start`, { identity: toPublicIdentity(utsav) })
    const { code } = start.body as { code: string }
    expect((await postJson(`${relay.url}/v1/pair/claim`, { code, identity: toPublicIdentity(utsav) })).status).toBe(400)
  })

  it("rejects an identity whose deviceId doesn't match its key", async () => {
    const fake = { ...toPublicIdentity(generateIdentity()), deviceId: generateIdentity().deviceId }
    expect((await postJson(`${relay.url}/v1/pair/start`, { identity: fake })).status).toBe(400)
  })

  it("rate-limits code guessing per IP", async () => {
    const statuses: number[] = []
    for (let i = 0; i < 12; i++) {
      statuses.push((await postJson(`${relay.url}/v1/pair/claim`, { code: "AAA-AAA", identity: toPublicIdentity(generateIdentity()) })).status)
    }
    expect(statuses.slice(0, 10).every((s) => s === 404)).toBe(true)
    expect(statuses.slice(10)).toEqual([429, 429])
  })

  it("behind a trusted proxy, limits per real client IP from the configured header", async () => {
    await relay.close()
    relay = await startRelay({ clientIpHeader: "fly-client-ip" })
    const claim = async (ip: string): Promise<number> =>
      (await postJson(`${relay.url}/v1/pair/claim`, { code: "AAA-AAA", identity: toPublicIdentity(generateIdentity()) }, { "fly-client-ip": ip })).status
    for (let i = 0; i < 10; i++) expect(await claim("1.1.1.1")).toBe(404)
    expect(await claim("1.1.1.1")).toBe(429)
    expect(await claim("2.2.2.2")).toBe(404) // a different person isn't blocked by the first
  })

  it("ignores the forwarded-IP header unless configured (it could be forged)", async () => {
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      statuses.push(
        (await postJson(`${relay.url}/v1/pair/claim`, { code: "AAA-AAA", identity: toPublicIdentity(generateIdentity()) }, { "fly-client-ip": `9.9.9.${i}` }))
          .status,
      )
    }
    expect(statuses.at(-1)).toBe(429)
  })
})

describe("websocket auth", () => {
  it("sends a challenge, then ready after a valid signature", async () => {
    const d = await connect(generateIdentity())
    const ready = await d.waitFor((f) => f.t === "ready")
    expect(ready).toEqual({ t: "ready", deviceId: d.identity.deviceId })
  })

  it("closes with 4401 on a bad signature", async () => {
    const d = await connect(generateIdentity(), { badSignature: true })
    expect(await d.waitForClose()).toBe(CloseCode.authFailed)
  })

  it("a send_only connection can send without kicking the listener or stealing its mail", async () => {
    const utsav = generateIdentity()
    const priyanshi = generateIdentity()
    await pair(utsav, priyanshi)
    const listener = await connectReady(utsav)
    await listener.waitFor(isDeliver) // pair_claimed stays with the listener
    const cli = await TestDevice.connect(relay.wsUrl, utsav, { mode: "send_only" })
    open.push(cli)
    await cli.waitFor((f) => f.t === "ready")
    const envelope = sealEnvelope({ sender: utsav, recipient: toPublicIdentity(priyanshi), payload: { type: "msg", text: "from cli" } })
    cli.send({ t: "send", ref: "r1", envelope })
    await cli.waitFor((f) => f.t === "sent")
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(listener.closeCode).toBeNull()
    expect(cli.frames.filter(isDeliver)).toHaveLength(0)
  })

  it("the newest connection for a device replaces the old one", async () => {
    const me = generateIdentity()
    const first = await connectReady(me)
    await connectReady(me)
    expect(await first.waitForClose()).toBe(CloseCode.replaced)
  })
})

describe("messaging", () => {
  it("delivers live between paired devices; ack removes it from the mailbox", async () => {
    const utsav = generateIdentity()
    const priyanshi = generateIdentity()
    await pair(utsav, priyanshi)
    const a = await connectReady(utsav)
    const b = await connectReady(priyanshi)
    await a.waitFor(isDeliver) // pair_claimed
    const envelope = sealEnvelope({ sender: utsav, recipient: toPublicIdentity(priyanshi), payload: { type: "msg", text: "hi" } })
    a.send({ t: "send", ref: "r1", envelope })
    expect(await a.waitFor((f) => f.t === "sent")).toEqual({ t: "sent", ref: "r1", id: envelope.id })
    const got = await b.waitFor(isDeliver)
    expect(got).toMatchObject({ delivery: { kind: "envelope", envelope } })
    if (!isDeliver(got)) throw new Error("unreachable")
    b.send({ t: "ack", seq: got.seq })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(relay.store.pending(priyanshi.deviceId, 100)).toHaveLength(0)
  })

  it("stores for an offline peer and delivers on connect; unacked mail is redelivered", async () => {
    const utsav = generateIdentity()
    const priyanshi = generateIdentity()
    await pair(utsav, priyanshi)
    const a = await connectReady(utsav)
    const envelope = sealEnvelope({ sender: utsav, recipient: toPublicIdentity(priyanshi), payload: { type: "msg", text: "offline hi" } })
    a.send({ t: "send", ref: "r1", envelope })
    await a.waitFor((f) => f.t === "sent")

    const b1 = await connectReady(priyanshi)
    await b1.waitFor(isDeliver)
    await b1.close() // no ack

    const b2 = await connectReady(priyanshi)
    expect(await b2.waitFor(isDeliver)).toMatchObject({ delivery: { kind: "envelope", envelope } })
  })

  it("refuses to relay between devices that never paired", async () => {
    const utsav = generateIdentity()
    const stranger = generateIdentity()
    const a = await connectReady(utsav)
    const envelope = sealEnvelope({ sender: utsav, recipient: toPublicIdentity(stranger), payload: { type: "msg", text: "spam" } })
    a.send({ t: "send", ref: "r1", envelope })
    expect(await a.waitFor((f) => f.t === "error")).toMatchObject({ code: "not_paired", ref: "r1" })
  })

  it("refuses an envelope whose from isn't the authenticated device", async () => {
    const utsav = generateIdentity()
    const priyanshi = generateIdentity()
    const eve = generateIdentity()
    await pair(utsav, priyanshi)
    const e = await connectReady(eve)
    const envelope = sealEnvelope({ sender: utsav, recipient: toPublicIdentity(priyanshi), payload: { type: "msg", text: "x" } })
    e.send({ t: "send", ref: "r1", envelope })
    expect(await e.waitFor((f) => f.t === "error")).toMatchObject({ code: "forbidden", ref: "r1" })
  })

  it("answers a malformed frame with bad_frame instead of crashing", async () => {
    const a = await connectReady(generateIdentity())
    a.ws.send("not json")
    expect(await a.waitFor((f) => f.t === "error")).toMatchObject({ code: "bad_frame" })
  })

  it("drops mail older than the mailbox TTL", async () => {
    const utsav = generateIdentity()
    const priyanshi = generateIdentity()
    await pair(utsav, priyanshi)
    const a = await connectReady(utsav)
    const envelope = sealEnvelope({ sender: utsav, recipient: toPublicIdentity(priyanshi), payload: { type: "msg", text: "old" } })
    a.send({ t: "send", ref: "r1", envelope })
    await a.waitFor((f) => f.t === "sent")
    relay.clock.now += 7 * 24 * 60 * 60_000 + 1
    const b = await connectReady(priyanshi)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(b.frames.filter(isDeliver)).toHaveLength(0)
  })
})

describe("abuse limits", () => {
  it("limits how many pairing codes one IP can create per minute", async () => {
    await relay.close()
    relay = await startRelay({ pairStartLimitPerMinute: 2 })
    const start = async (): Promise<number> => (await postJson(`${relay.url}/v1/pair/start`, { identity: toPublicIdentity(generateIdentity()) })).status
    expect([await start(), await start(), await start()]).toEqual([200, 200, 429])
    relay.clock.now += 60_000
    expect(await start()).toBe(200)
  })

  it("limits how many messages one device can send per minute", async () => {
    await relay.close()
    relay = await startRelay({ sendLimitPerMinute: 2 })
    const utsav = generateIdentity()
    const priyanshi = generateIdentity()
    await pair(utsav, priyanshi)
    const a = await connectReady(utsav)
    for (const ref of ["r1", "r2", "r3"]) {
      const envelope = sealEnvelope({ sender: utsav, recipient: toPublicIdentity(priyanshi), payload: { type: "msg", text: ref } })
      a.send({ t: "send", ref, envelope })
    }
    await a.waitFor((f) => f.t === "sent" && f.ref === "r2")
    expect(await a.waitFor((f) => f.t === "error")).toMatchObject({ code: "rate_limited", ref: "r3" })
    expect(relay.store.pending(priyanshi.deviceId, 100)).toHaveLength(2)
  })

  it("caps open connections per IP and frees the slot when one closes", async () => {
    await relay.close()
    relay = await startRelay({ maxConnectionsPerIp: 2 })
    const first = await connectReady(generateIdentity())
    await connectReady(generateIdentity())
    const closeCode = await new Promise<number>((resolve) => {
      const ws = new WebSocket(relay.wsUrl)
      ws.on("close", (code) => {
        resolve(code)
      })
    })
    expect(closeCode).toBe(CloseCode.tooManyConnections)
    await first.close()
    await new Promise((resolve) => setTimeout(resolve, 50))
    await connectReady(generateIdentity())
  })
})

describe("shutdown", () => {
  it("closing the relay with paired devices online doesn't touch the closed store", async () => {
    const utsav = generateIdentity()
    const priyanshi = generateIdentity()
    await pair(utsav, priyanshi)
    const a = await connectReady(utsav)
    const b = await connectReady(priyanshi)
    await relay.close()
    await a.waitForClose()
    await b.waitForClose()
    // Give the sockets' close handlers a tick; an uncaught "database connection is not open" fails the run.
    await new Promise((resolve) => setTimeout(resolve, 50))
    relay = await startRelay() // afterEach closes this fresh one
  })
})

describe("presence and unpair", () => {
  it("tells a paired peer when you come online, go busy, and go offline", async () => {
    const utsav = generateIdentity()
    const priyanshi = generateIdentity()
    await pair(utsav, priyanshi)
    const a = await connectReady(utsav)
    const b = await connectReady(priyanshi)
    expect(await a.waitFor((f) => f.t === "presence" && f.status === "online")).toMatchObject({ deviceId: priyanshi.deviceId })
    b.send({ t: "status", status: "busy" })
    await a.waitFor((f) => f.t === "presence" && f.status === "busy")
    a.send({ t: "presence_query" })
    expect(await a.waitFor((f) => f.t === "presence_state")).toEqual({
      t: "presence_state",
      peers: [{ deviceId: priyanshi.deviceId, status: "busy" }],
    })
    await b.close()
    await a.waitFor((f) => f.t === "presence" && f.status === "offline")
  })

  it("unpair stops further relaying and tells the other side", async () => {
    const utsav = generateIdentity()
    const priyanshi = generateIdentity()
    await pair(utsav, priyanshi)
    const a = await connectReady(utsav)
    a.send({ t: "unpair", peer: priyanshi.deviceId })
    const b = await connectReady(priyanshi)
    expect(await b.waitFor((f) => isDeliver(f) && f.delivery.kind === "unpaired")).toMatchObject({
      delivery: { kind: "unpaired", peer: utsav.deviceId },
    })
    const envelope = sealEnvelope({ sender: priyanshi, recipient: toPublicIdentity(utsav), payload: { type: "msg", text: "x" } })
    b.send({ t: "send", ref: "r1", envelope })
    expect(await b.waitFor((f) => f.t === "error")).toMatchObject({ code: "not_paired" })
  })
})
