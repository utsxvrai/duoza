import { randomBytes } from "node:crypto"
import type { ClientFrame, Delivery, PresenceStatus, PublicIdentity, RelayErrorCode, ServerFrame } from "@duoza/protocol"
import {
  ClientFrameSchema,
  CloseCode,
  generatePairingCode,
  normalizePairingCode,
  PairClaimBodySchema,
  PairStartBodySchema,
  verifyChallenge,
} from "@duoza/protocol"
import websocket from "@fastify/websocket"
import type { FastifyBaseLogger, FastifyInstance } from "fastify"
import Fastify from "fastify"
import type { WebSocket } from "ws"
import { FixedWindowLimiter } from "./limiter.js"
import type { SqliteStore } from "./store.js"

export interface RelayOptions {
  store: SqliteStore
  now: () => number
  pairTtlMs: number
  mailboxTtlMs: number
  mailboxMax: number
  claimLimitPerMinute: number
  /** Pairing codes one IP may create per minute. */
  pairStartLimitPerMinute: number
  /** Envelopes one device may send per minute. */
  sendLimitPerMinute: number
  /** Open WebSocket connections allowed from one IP. */
  maxConnectionsPerIp: number
  authTimeoutMs: number
  heartbeatMs: number
  maxFrameBytes: number
  logger: boolean | FastifyBaseLogger
  /**
   * Header carrying the real client IP when the relay sits behind a trusted proxy
   * (Fly.io sets "fly-client-ip"). Only set this behind such a proxy: clients can forge it otherwise.
   */
  clientIpHeader: string | null
}

const DEFAULTS: Omit<RelayOptions, "store"> = {
  now: () => Date.now(),
  pairTtlMs: 10 * 60_000,
  mailboxTtlMs: 7 * 24 * 60 * 60_000,
  mailboxMax: 1000,
  claimLimitPerMinute: 10,
  pairStartLimitPerMinute: 20,
  sendLimitPerMinute: 120,
  maxConnectionsPerIp: 20,
  authTimeoutMs: 10_000,
  heartbeatMs: 30_000,
  maxFrameBytes: 512 * 1024,
  logger: false,
  clientIpHeader: null,
}

interface Session {
  socket: WebSocket
  deviceId: string
  status: Exclude<PresenceStatus, "offline">
  mode: "listen" | "send_only"
  alive: boolean
}

export function buildRelay(partial: Partial<RelayOptions> & { store: SqliteStore }): FastifyInstance {
  const opts: RelayOptions = { ...DEFAULTS, ...partial }
  const { store } = opts
  const sessions = new Map<string, Session>()
  const claimLimiter = new FixedWindowLimiter(opts.claimLimitPerMinute, 60_000)
  const pairStartLimiter = new FixedWindowLimiter(opts.pairStartLimitPerMinute, 60_000)
  const sendLimiter = new FixedWindowLimiter(opts.sendLimitPerMinute, 60_000)
  const connectionsByIp = new Map<string, number>()
  let shuttingDown = false

  function clientIpOf(req: { ip: string; headers: Record<string, string | string[] | undefined> }): string {
    const forwarded = opts.clientIpHeader === null ? undefined : req.headers[opts.clientIpHeader.toLowerCase()]
    return typeof forwarded === "string" && forwarded.length > 0 ? forwarded : req.ip
  }

  const app = Fastify({ logger: opts.logger, bodyLimit: opts.maxFrameBytes })

  // ---- helpers ---------------------------------------------------------------

  function send(socket: WebSocket, frame: ServerFrame): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame))
  }

  function sendError(socket: WebSocket, code: RelayErrorCode, message: string, ref?: string): void {
    send(socket, ref === undefined ? { t: "error", code, message } : { t: "error", code, ref, message })
  }

  function statusOf(deviceId: string): PresenceStatus {
    return sessions.get(deviceId)?.status ?? "offline"
  }

  function broadcastPresence(deviceId: string, status: PresenceStatus): void {
    for (const peer of store.peersOf(deviceId)) {
      const s = sessions.get(peer)
      if (s !== undefined) send(s.socket, { t: "presence", deviceId, status })
    }
  }

  /** Persist first, then push if the recipient is online; it stays queued until acked. */
  function deliver(toId: string, delivery: Delivery): void {
    const seq = store.enqueue(toId, delivery, opts.now())
    const s = sessions.get(toId)
    if (s !== undefined) send(s.socket, { t: "deliver", seq, delivery })
  }

  function flushMailbox(session: Session): void {
    const notBefore = opts.now() - opts.mailboxTtlMs
    for (const row of store.pending(session.deviceId, opts.mailboxMax, notBefore)) {
      send(session.socket, { t: "deliver", seq: row.seq, delivery: row.delivery })
    }
  }

  // ---- HTTP ------------------------------------------------------------------

  app.get("/health", async () => ({ ok: true }))

  app.post("/v1/pair/start", async (req, reply) => {
    if (!pairStartLimiter.hit(clientIpOf(req), opts.now())) {
      return await reply.code(429).send({ error: "too_many_codes" })
    }
    const body = PairStartBodySchema.safeParse(req.body)
    if (!body.success) return await reply.code(400).send({ error: "bad_request" })
    const identity: PublicIdentity = body.data.identity
    if (store.upsertDevice(identity, opts.now()) === "key_conflict") {
      return await reply.code(409).send({ error: "key_conflict" })
    }
    const expiresAt = opts.now() + opts.pairTtlMs
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generatePairingCode()
      if (store.createPairSlot(normalizePairingCode(code) as string, identity.deviceId, expiresAt)) {
        return { code, expiresAt }
      }
    }
    return await reply.code(503).send({ error: "try_again" })
  })

  app.post("/v1/pair/claim", async (req, reply) => {
    if (!claimLimiter.hit(clientIpOf(req), opts.now())) {
      return await reply.code(429).send({ error: "too_many_attempts" })
    }
    const body = PairClaimBodySchema.safeParse(req.body)
    if (!body.success) return await reply.code(400).send({ error: "bad_request" })
    const code = normalizePairingCode(body.data.code)
    if (code === null) return await reply.code(404).send({ error: "unknown_or_expired_code" })
    const claimant: PublicIdentity = body.data.identity
    const initiatorId = store.claimPairSlot(code, opts.now())
    if (initiatorId === null) return await reply.code(404).send({ error: "unknown_or_expired_code" })
    if (initiatorId === claimant.deviceId) return await reply.code(400).send({ error: "cannot_pair_with_self" })
    const initiator = store.getDevice(initiatorId)
    if (initiator === null) return await reply.code(404).send({ error: "unknown_or_expired_code" })
    if (store.upsertDevice(claimant, opts.now()) === "key_conflict") {
      return await reply.code(409).send({ error: "key_conflict" })
    }
    store.addPair(initiatorId, claimant.deviceId, opts.now())
    deliver(initiatorId, { kind: "pair_claimed", code, peer: claimant })
    return { peer: initiator }
  })

  // ---- WebSocket -------------------------------------------------------------

  function handleFrame(session: Session, frame: ClientFrame): void {
    switch (frame.t) {
      case "auth":
        sendError(session.socket, "bad_frame", "already authenticated")
        return
      case "send": {
        const env = frame.envelope
        if (env.from !== session.deviceId) {
          sendError(session.socket, "forbidden", "envelope.from must be your own device", frame.ref)
          return
        }
        if (!store.isPaired(env.from, env.to)) {
          sendError(session.socket, "not_paired", "recipient is not paired with you", frame.ref)
          return
        }
        if (!sendLimiter.hit(session.deviceId, opts.now())) {
          sendError(session.socket, "rate_limited", "too many messages; slow down", frame.ref)
          return
        }
        if (store.countPending(env.to) >= opts.mailboxMax) {
          sendError(session.socket, "mailbox_full", "recipient mailbox is full", frame.ref)
          return
        }
        deliver(env.to, { kind: "envelope", envelope: env })
        send(session.socket, { t: "sent", ref: frame.ref, id: env.id })
        return
      }
      case "ack":
        if (session.mode === "listen") store.ack(session.deviceId, frame.seq)
        return
      case "status":
        if (session.mode !== "listen") return
        session.status = frame.status
        broadcastPresence(session.deviceId, frame.status)
        return
      case "presence_query":
        send(session.socket, {
          t: "presence_state",
          peers: store
            .peersOf(session.deviceId)
            .sort()
            .map((deviceId) => ({ deviceId, status: statusOf(deviceId) })),
        })
        return
      case "unpair":
        if (store.removePair(session.deviceId, frame.peer)) {
          deliver(frame.peer, { kind: "unpaired", peer: session.deviceId })
        }
    }
  }

  function parseFrame(raw: unknown): ClientFrame | null {
    try {
      const parsed = ClientFrameSchema.safeParse(JSON.parse(String(raw)))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  void app.register(websocket, { options: { maxPayload: opts.maxFrameBytes } })

  void app.register(async (scope) => {
    scope.get("/v1/ws", { websocket: true }, (socket, req) => {
      const ip = clientIpOf(req)
      const open = (connectionsByIp.get(ip) ?? 0) + 1
      if (open > opts.maxConnectionsPerIp) {
        socket.close(CloseCode.tooManyConnections, "too many connections from this address")
        return
      }
      connectionsByIp.set(ip, open)
      socket.once("close", () => {
        const left = (connectionsByIp.get(ip) ?? 1) - 1
        if (left <= 0) connectionsByIp.delete(ip)
        else connectionsByIp.set(ip, left)
      })

      const nonce = randomBytes(32).toString("base64")
      let session: Session | null = null
      const authTimer = setTimeout(() => {
        socket.close(CloseCode.authTimeout, "auth timeout")
      }, opts.authTimeoutMs)

      send(socket, { t: "challenge", nonce })

      socket.on("message", (raw) => {
        const frame = parseFrame(raw)
        if (frame === null) {
          sendError(socket, "bad_frame", "frame did not match the protocol")
          return
        }
        if (session !== null) {
          handleFrame(session, frame)
          return
        }
        if (frame.t !== "auth" || !verifyChallenge(frame.identity.signPublicKey, nonce, frame.sig)) {
          socket.close(CloseCode.authFailed, "auth failed")
          return
        }
        if (store.upsertDevice(frame.identity, opts.now()) === "key_conflict") {
          socket.close(CloseCode.authFailed, "key conflict")
          return
        }
        clearTimeout(authTimer)
        const deviceId = frame.identity.deviceId
        if (frame.mode === "send_only") {
          session = { socket, deviceId, status: "online", mode: "send_only", alive: true }
          send(socket, { t: "ready", deviceId })
          return
        }
        const previous = sessions.get(deviceId)
        if (previous !== undefined) previous.socket.close(CloseCode.replaced, "replaced by a newer connection")
        session = { socket, deviceId, status: "online", mode: "listen", alive: true }
        sessions.set(deviceId, session)
        send(socket, { t: "ready", deviceId })
        flushMailbox(session)
        broadcastPresence(deviceId, "online")
      })

      socket.on("pong", () => {
        if (session !== null) session.alive = true
      })

      socket.on("close", () => {
        clearTimeout(authTimer)
        if (session !== null && sessions.get(session.deviceId) === session) {
          sessions.delete(session.deviceId)
          // During shutdown the store may already be closed; peers are going offline anyway.
          if (!shuttingDown) broadcastPresence(session.deviceId, "offline")
        }
      })
    })
  })

  // ---- housekeeping ------------------------------------------------------------

  const heartbeat = setInterval(() => {
    for (const s of sessions.values()) {
      if (!s.alive) {
        s.socket.terminate()
        continue
      }
      s.alive = false
      s.socket.ping()
    }
    const now = opts.now()
    store.purge(now - opts.mailboxTtlMs, now)
    claimLimiter.sweep(now)
    pairStartLimiter.sweep(now)
    sendLimiter.sweep(now)
  }, opts.heartbeatMs)
  heartbeat.unref()

  app.addHook("preClose", async () => {
    shuttingDown = true
  })

  app.addHook("onClose", async () => {
    shuttingDown = true
    clearInterval(heartbeat)
    for (const s of sessions.values()) s.socket.close(1001, "relay shutting down")
  })

  return app
}
