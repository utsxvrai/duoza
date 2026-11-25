import type { Identity, ServerFrame } from "@duoza/protocol"
import { signChallenge, toPublicIdentity } from "@duoza/protocol"
import type { FastifyInstance } from "fastify"
import WebSocket from "ws"
import type { RelayOptions } from "../src/app.js"
import { buildRelay } from "../src/app.js"
import { SqliteStore } from "../src/store.js"

export interface TestRelay {
  app: FastifyInstance
  url: string
  wsUrl: string
  clock: { now: number }
  store: SqliteStore
  close: () => Promise<void>
}

export async function startRelay(opts: Partial<RelayOptions> = {}): Promise<TestRelay> {
  const clock = { now: 1_800_000_000_000 }
  const store = new SqliteStore(":memory:")
  const app = buildRelay({ store, now: () => clock.now, ...opts })
  await app.listen({ port: 0, host: "127.0.0.1" })
  const address = app.server.address()
  if (address === null || typeof address === "string") throw new Error("relay did not bind a port")
  const url = `http://127.0.0.1:${address.port}`
  return {
    app,
    url,
    wsUrl: `ws://127.0.0.1:${address.port}/v1/ws`,
    clock,
    store,
    close: async () => {
      await app.close()
      store.close()
    },
  }
}

export async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) })
  return { status: res.status, body: await res.json() }
}

/** A connected device that records every frame it receives. */
export class TestDevice {
  readonly frames: ServerFrame[] = []
  closeCode: number | null = null
  private waiters: Array<() => void> = []

  private constructor(
    readonly ws: WebSocket,
    readonly identity: Identity,
  ) {
    ws.on("message", (raw) => {
      this.frames.push(JSON.parse(String(raw)) as ServerFrame)
      this.flush()
    })
    ws.on("close", (code) => {
      this.closeCode = code
      this.flush()
    })
  }

  static async connect(wsUrl: string, identity: Identity, opts: { badSignature?: boolean; mode?: "listen" | "send_only" } = {}): Promise<TestDevice> {
    const ws = new WebSocket(wsUrl)
    const device = new TestDevice(ws, identity)
    const challenge = await device.waitFor((f) => f.t === "challenge")
    if (challenge.t !== "challenge") throw new Error("unreachable")
    const sig = opts.badSignature === true ? signChallenge(identity, Buffer.alloc(32).toString("base64")) : signChallenge(identity, challenge.nonce)
    device.send({ t: "auth", identity: toPublicIdentity(identity), sig, ...(opts.mode === undefined ? {} : { mode: opts.mode }) })
    return device
  }

  send(frame: unknown): void {
    this.ws.send(JSON.stringify(frame))
  }

  async waitFor(predicate: (f: ServerFrame) => boolean, timeoutMs = 2000): Promise<ServerFrame> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const found = this.frames.find(predicate)
      if (found !== undefined) return found
      if (Date.now() > deadline) throw new Error(`timed out waiting for frame; got ${JSON.stringify(this.frames)}`)
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve)
        setTimeout(resolve, 50)
      })
    }
  }

  async waitForClose(timeoutMs = 2000): Promise<number> {
    const deadline = Date.now() + timeoutMs
    while (this.closeCode === null) {
      if (Date.now() > deadline) throw new Error("timed out waiting for close")
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    return this.closeCode
  }

  async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return
    this.ws.close()
    await this.waitForClose()
  }

  private flush(): void {
    const waiters = this.waiters
    this.waiters = []
    for (const w of waiters) w()
  }
}
