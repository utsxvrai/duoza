import { randomUUID } from "node:crypto"
import type { Delivery, Envelope, Identity, PresenceStatus, ServerFrame } from "@duoza/protocol"
import { CloseCode, signChallenge, toPublicIdentity } from "@duoza/protocol"
import WebSocket from "ws"
import { DuozaClientError } from "./errors.js"

export interface OpenOptions {
  wsUrl: string
  identity: Identity
  mode: "listen" | "send_only"
  /** Called for each delivery, one at a time. The relay copy is acked only after this resolves. */
  onDelivery?: (delivery: Delivery) => Promise<void> | void
  onPresence?: (deviceId: string, status: PresenceStatus) => void
  onClose?: (code: number) => void
  timeoutMs?: number
}

interface Waiter {
  resolve: (frame: ServerFrame) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

/** One authenticated WebSocket to the relay. */
export class RelayConnection {
  private readonly waiters = new Map<string, Waiter>()
  private presenceWaiter: Waiter | null = null
  private chain: Promise<void> = Promise.resolve()
  private closed = false

  private constructor(
    private readonly ws: WebSocket,
    private readonly opts: OpenOptions,
  ) {}

  static async open(opts: OpenOptions): Promise<RelayConnection> {
    const timeoutMs = opts.timeoutMs ?? 10_000
    const ws = new WebSocket(opts.wsUrl)
    const conn = new RelayConnection(ws, opts)

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.terminate()
        reject(new DuozaClientError("timeout", "relay did not answer in time"))
      }, timeoutMs)
      let ready = false

      ws.on("message", (raw) => {
        let frame: ServerFrame
        try {
          frame = JSON.parse(String(raw)) as ServerFrame
        } catch {
          return
        }
        if (!ready && frame.t === "challenge") {
          ws.send(JSON.stringify({ t: "auth", identity: toPublicIdentity(opts.identity), sig: signChallenge(opts.identity, frame.nonce), mode: opts.mode }))
          return
        }
        if (!ready && frame.t === "ready") {
          ready = true
          clearTimeout(timer)
          resolve()
          return
        }
        conn.onFrame(frame)
      })

      ws.on("error", (err) => {
        if (!ready) {
          clearTimeout(timer)
          reject(new DuozaClientError("relay_unreachable", `can't reach the relay at ${opts.wsUrl}: ${err.message}`))
        }
      })

      ws.on("close", (code) => {
        conn.closed = true
        conn.failAll(new DuozaClientError("relay_unreachable", `relay connection closed (${code})`))
        if (!ready) {
          clearTimeout(timer)
          reject(new DuozaClientError(code === CloseCode.authFailed ? "relay_error" : "relay_unreachable", `relay closed the connection (${code})`))
          return
        }
        opts.onClose?.(code)
      })
    })
    return conn
  }

  get isOpen(): boolean {
    return !this.closed
  }

  async send(envelope: Envelope): Promise<void> {
    const ref = randomUUID()
    const frame = this.expect(ref)
    this.ws.send(JSON.stringify({ t: "send", ref, envelope }))
    await frame
  }

  async presence(): Promise<Array<{ deviceId: string; status: PresenceStatus }>> {
    const pending = new Promise<ServerFrame>((resolve, reject) => {
      this.presenceWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          reject(new DuozaClientError("timeout", "no presence answer"))
        }, this.opts.timeoutMs ?? 10_000),
      }
    })
    this.ws.send(JSON.stringify({ t: "presence_query" }))
    const frame = await pending
    return frame.t === "presence_state" ? frame.peers : []
  }

  async setStatus(status: "online" | "busy"): Promise<void> {
    await this.sendRaw({ t: "status", status })
  }

  async unpair(deviceId: string): Promise<void> {
    await this.sendRaw({ t: "unpair", peer: deviceId })
  }

  async close(): Promise<void> {
    if (this.closed || this.ws.readyState === WebSocket.CLOSED) return
    await this.chain
    await new Promise<void>((resolve) => {
      this.ws.once("close", () => {
        resolve()
      })
      this.ws.close()
    })
  }

  // ---- internals -----------------------------------------------------------------

  private async sendRaw(frame: unknown): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.ws.send(JSON.stringify(frame), (err) => {
        err === undefined || err === null ? resolve() : reject(err)
      })
    })
  }

  private expect(ref: string): Promise<ServerFrame> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(ref)
        reject(new DuozaClientError("timeout", "relay did not confirm the message"))
      }, this.opts.timeoutMs ?? 10_000)
      this.waiters.set(ref, { resolve, reject, timer })
    })
  }

  private settle(ref: string, frame: ServerFrame, err?: Error): void {
    const w = this.waiters.get(ref)
    if (w === undefined) return
    this.waiters.delete(ref)
    clearTimeout(w.timer)
    if (err === undefined) w.resolve(frame)
    else w.reject(err)
  }

  private failAll(err: Error): void {
    for (const [ref, w] of this.waiters) {
      clearTimeout(w.timer)
      w.reject(err)
      this.waiters.delete(ref)
    }
    if (this.presenceWaiter !== null) {
      clearTimeout(this.presenceWaiter.timer)
      this.presenceWaiter.reject(err)
      this.presenceWaiter = null
    }
  }

  private onFrame(frame: ServerFrame): void {
    switch (frame.t) {
      case "sent":
        this.settle(frame.ref, frame)
        return
      case "error":
        if (frame.ref !== undefined) {
          const code = frame.code === "not_paired" || frame.code === "rate_limited" ? frame.code : "relay_error"
          this.settle(frame.ref, frame, new DuozaClientError(code, `relay refused: ${frame.code} (${frame.message})`))
        }
        return
      case "presence_state":
        if (this.presenceWaiter !== null) {
          clearTimeout(this.presenceWaiter.timer)
          this.presenceWaiter.resolve(frame)
          this.presenceWaiter = null
        }
        return
      case "presence":
        this.opts.onPresence?.(frame.deviceId, frame.status)
        return
      case "deliver": {
        const handler = this.opts.onDelivery
        if (handler === undefined) return
        this.chain = this.chain.then(async () => {
          try {
            await handler(frame.delivery)
            this.ws.send(JSON.stringify({ t: "ack", seq: frame.seq }))
          } catch (err) {
            process.stderr.write(`duoza: failed to handle a delivery, it will be retried: ${String(err)}\n`)
          }
        })
      }
    }
  }
}
