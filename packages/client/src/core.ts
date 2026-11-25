import { randomUUID } from "node:crypto"
import type { Delivery, Identity, Payload, PresenceStatus } from "@duoza/protocol"
import { fingerprint, normalizePairingCode, openEnvelope, PublicIdentitySchema, sealEnvelope } from "@duoza/protocol"
import { DuozaClientError } from "./errors.js"
import { RelayConnection } from "./relay-connection.js"
import type { InboundQuery, LocalStore, Peer } from "./store.js"

export interface HandoffPacket {
  summary: string
  branch: string
  headSha: string
  diffStat: string
  openQuestions: string[]
}

/** What the listener reports to the Claude session, already labelled with local nicknames. */
export type DuozaEvent =
  | { kind: "paired"; name: string; fingerprint: string[] }
  | { kind: "unpaired"; name: string }
  | { kind: "msg"; from: string; text: string }
  | { kind: "query_pending"; from: string; number: number }
  | { kind: "query_ack"; from: string; queryId: string; accepted: boolean; text: string }
  | { kind: "query_result"; from: string; queryId: string; summary: string; text: string }
  | { kind: "handoff"; from: string; handoff: HandoffPacket }

export interface InboundQueryView extends InboundQuery {
  fromName: string
}

export interface PeerView {
  name: string
  status: PresenceStatus
  fingerprint: string[]
}

export interface DuozaOptions {
  store: LocalStore
  /** http(s) base URL of the relay, e.g. https://relay.duoza.dev */
  relayUrl: string
  now?: () => number
}

export class Duoza {
  private readonly store: LocalStore
  private readonly relayUrl: string
  private readonly now: () => number
  private cachedIdentity: Identity | null = null

  constructor(opts: DuozaOptions) {
    this.store = opts.store
    this.relayUrl = opts.relayUrl.replace(/\/+$/, "")
    this.now = opts.now ?? (() => Date.now())
  }

  get identity(): Identity {
    this.cachedIdentity ??= this.store.loadOrCreateIdentity()
    return this.cachedIdentity
  }

  get wsUrl(): string {
    return `${this.relayUrl.replace(/^http/, "ws")}/v1/ws`
  }

  // ---- pairing -------------------------------------------------------------------

  /** Creates a one-time code to hand to `name`. */
  async request(name: string): Promise<{ code: string; expiresAt: number }> {
    this.store.assertValidName(name)
    if (this.store.findPeer(name) !== null) {
      throw new DuozaClientError("name_taken", `you already have a peer called "${name}"`)
    }
    const res = await this.post("/v1/pair/start", { identity: this.publicIdentity() })
    if (res.status !== 200) throw new DuozaClientError("relay_error", `relay refused to create a code (${res.status})`)
    const { code, expiresAt } = res.body as { code: string; expiresAt: number }
    this.store.addPendingPair(normalizePairingCode(code) ?? code, name, expiresAt)
    return { code, expiresAt }
  }

  /** Redeems a code someone gave you; `name` is what you'll call them. */
  async pair(name: string, code: string): Promise<{ name: string; fingerprint: string[] }> {
    this.store.assertValidName(name)
    if (this.store.findPeer(name) !== null) {
      throw new DuozaClientError("name_taken", `you already have a peer called "${name}"`)
    }
    if (normalizePairingCode(code) === null) {
      throw new DuozaClientError("bad_code", "that doesn't look like a Duoza code (it should look like K7P-42Q)")
    }
    const res = await this.post("/v1/pair/claim", { code, identity: this.publicIdentity() })
    if (res.status === 404) throw new DuozaClientError("bad_code", "that code is wrong, already used, or expired; ask for a new one")
    if (res.status === 429) throw new DuozaClientError("rate_limited", "too many attempts; wait a minute and try again")
    if (res.status === 400) throw new DuozaClientError("bad_code", "you can't pair with yourself")
    if (res.status !== 200) throw new DuozaClientError("relay_error", `relay refused the code (${res.status})`)
    const peer = PublicIdentitySchema.safeParse((res.body as { peer?: unknown }).peer)
    if (!peer.success) throw new DuozaClientError("relay_error", "relay sent a malformed identity")
    this.store.addPeer(name, peer.data, this.now())
    return { name, fingerprint: fingerprint(this.identity.signPublicKey, peer.data.signPublicKey) }
  }

  // ---- sending -------------------------------------------------------------------

  async send(name: string, text: string): Promise<void> {
    await this.sendPayload(this.requirePeer(name), { type: "msg", text })
  }

  async query(name: string, text: string): Promise<{ queryId: string }> {
    const peer = this.requirePeer(name)
    const queryId = randomUUID()
    await this.sendPayload(peer, { type: "query", queryId, text })
    this.store.addOutboundQuery({ queryId, to: peer.identity.deviceId, text, sentAt: this.now() })
    return { queryId }
  }

  async handoff(name: string, packet: HandoffPacket): Promise<void> {
    await this.sendPayload(this.requirePeer(name), { type: "handoff", ...packet })
  }

  // ---- receiving a query ---------------------------------------------------------

  show(number: number): InboundQueryView {
    return this.viewInbound(number)
  }

  async accept(number: number): Promise<InboundQueryView> {
    const q = this.viewInbound(number)
    if (q.state !== "pending") throw new DuozaClientError("already_handled", `request #${number} is already ${q.state}`)
    await this.sendPayload(this.requirePeerByDevice(q.from), { type: "query_ack", queryId: q.queryId, accepted: true })
    this.store.setInboundQueryState(number, "accepted")
    return { ...q, state: "accepted" }
  }

  async reject(number: number): Promise<InboundQueryView> {
    const q = this.viewInbound(number)
    if (q.state !== "pending") throw new DuozaClientError("already_handled", `request #${number} is already ${q.state}`)
    await this.sendPayload(this.requirePeerByDevice(q.from), { type: "query_ack", queryId: q.queryId, accepted: false })
    this.store.setInboundQueryState(number, "rejected")
    return { ...q, state: "rejected" }
  }

  /** Sends the outcome of an accepted request back to whoever asked. */
  async result(queryId: string, summary: string): Promise<{ to: string }> {
    const q = this.store.findInboundQueryById(queryId)
    if (q === null) throw new DuozaClientError("not_found", `no request with id ${queryId}`)
    if (q.state !== "accepted") throw new DuozaClientError("not_accepted", `request #${q.number} is ${q.state}, not accepted`)
    const peer = this.requirePeerByDevice(q.from)
    await this.sendPayload(peer, { type: "query_result", queryId, summary })
    this.store.setInboundQueryState(q.number, "done")
    return { to: peer.name }
  }

  // ---- peers ---------------------------------------------------------------------

  async peers(): Promise<PeerView[]> {
    const peers = this.store.listPeers()
    let statuses: Array<{ deviceId: string; status: PresenceStatus }> = []
    if (peers.length > 0) {
      statuses = await this.withSender(async (conn) => await conn.presence())
    }
    return peers.map((p) => ({
      name: p.name,
      status: statuses.find((s) => s.deviceId === p.identity.deviceId)?.status ?? "offline",
      fingerprint: fingerprint(this.identity.signPublicKey, p.identity.signPublicKey),
    }))
  }

  async unpair(name: string): Promise<void> {
    const peer = this.requirePeer(name)
    await this.withSender(async (conn) => {
      await conn.unpair(peer.identity.deviceId)
    })
    this.store.removePeer(peer.name)
  }

  // ---- listening -------------------------------------------------------------------

  /** Opens the long-lived connection; every delivery becomes at most one event. */
  async listen(
    onEvent: (event: DuozaEvent) => Promise<void> | void,
    extra: Partial<Pick<Parameters<typeof RelayConnection.open>[0], "onClose" | "onPresence">> = {},
  ): Promise<RelayConnection> {
    return await RelayConnection.open({
      wsUrl: this.wsUrl,
      identity: this.identity,
      mode: "listen",
      ...extra,
      onDelivery: async (delivery) => {
        const event = await this.handleDelivery(delivery)
        if (event !== null) await onEvent(event)
      },
    })
  }

  /** Turns one relay delivery into an event, or null if it should be ignored. */
  async handleDelivery(delivery: Delivery): Promise<DuozaEvent | null> {
    switch (delivery.kind) {
      case "pair_claimed": {
        const name = this.store.takePendingPair(delivery.code, this.now())
        const peer = PublicIdentitySchema.safeParse(delivery.peer)
        if (name === null || !peer.success) return null
        try {
          this.store.addPeer(name, peer.data, this.now())
        } catch {
          return null
        }
        return { kind: "paired", name, fingerprint: fingerprint(this.identity.signPublicKey, peer.data.signPublicKey) }
      }
      case "unpaired": {
        const peer = this.store.findPeerByDevice(delivery.peer)
        if (peer === null) return null
        this.store.removePeer(peer.name)
        return { kind: "unpaired", name: peer.name }
      }
      case "envelope":
        return this.handleEnvelope(delivery.envelope)
    }
  }

  // ---- internals -------------------------------------------------------------------

  private handleEnvelope(envelope: Extract<Delivery, { kind: "envelope" }>["envelope"]): DuozaEvent | null {
    const peer = this.store.findPeerByDevice(envelope.from)
    if (peer === null) return null
    if (!this.store.markSeen(envelope.id)) return null
    let payload: Payload
    try {
      payload = openEnvelope({ envelope, me: this.identity, sender: peer.identity })
    } catch {
      return null
    }
    const from = peer.name
    switch (payload.type) {
      case "msg":
        return { kind: "msg", from, text: payload.text }
      case "query": {
        const number = this.store.addInboundQuery({ queryId: payload.queryId, from: peer.identity.deviceId, text: payload.text, receivedAt: this.now() })
        return { kind: "query_pending", from, number }
      }
      case "query_ack":
        return { kind: "query_ack", from, queryId: payload.queryId, accepted: payload.accepted, text: this.outboundText(payload.queryId, peer) }
      case "query_result":
        return { kind: "query_result", from, queryId: payload.queryId, summary: payload.summary, text: this.outboundText(payload.queryId, peer) }
      case "handoff": {
        const { type: _type, ...handoff } = payload
        return { kind: "handoff", from, handoff }
      }
    }
  }

  private outboundText(queryId: string, peer: Peer): string {
    const q = this.store.findOutboundQuery(queryId)
    return q !== null && q.to === peer.identity.deviceId ? q.text : ""
  }

  private viewInbound(number: number): InboundQueryView {
    const q = this.store.getInboundQuery(number)
    if (q === null) throw new DuozaClientError("not_found", `no request #${number}`)
    return { ...q, fromName: this.store.findPeerByDevice(q.from)?.name ?? "(unpaired)" }
  }

  private requirePeer(name: string): Peer {
    const peer = this.store.findPeer(name)
    if (peer === null) {
      if (this.store.hasPendingPairFor(name, this.now())) {
        throw new DuozaClientError(
          "unknown_peer",
          `"${name}" hasn't used your code yet, or your Duoza listener isn't running to receive their confirmation. Once they pair, you'll see "paired with ${name}".`,
        )
      }
      const known = this.store.listPeers().map((p) => p.name)
      throw new DuozaClientError(
        "unknown_peer",
        `no peer called "${name}"${known.length > 0 ? ` (you have: ${known.join(", ")})` : " (pair first with /duoza:request)"}`,
      )
    }
    return peer
  }

  private requirePeerByDevice(deviceId: string): Peer {
    const peer = this.store.findPeerByDevice(deviceId)
    if (peer === null) throw new DuozaClientError("unknown_peer", "the person who sent this is no longer paired")
    return peer
  }

  private publicIdentity(): { deviceId: string; signPublicKey: string; boxPublicKey: string } {
    const { deviceId, signPublicKey, boxPublicKey } = this.identity
    return { deviceId, signPublicKey, boxPublicKey }
  }

  private async sendPayload(peer: Peer, payload: Payload): Promise<void> {
    const envelope = sealEnvelope({ sender: this.identity, recipient: peer.identity, payload })
    await this.withSender(async (conn) => {
      await conn.send(envelope)
    })
  }

  private async withSender<T>(fn: (conn: RelayConnection) => Promise<T>): Promise<T> {
    const conn = await RelayConnection.open({ wsUrl: this.wsUrl, identity: this.identity, mode: "send_only" })
    try {
      return await fn(conn)
    } finally {
      await conn.close()
    }
  }

  private async post(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
    let res: Response
    try {
      res = await fetch(`${this.relayUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      })
    } catch (err) {
      throw new DuozaClientError("relay_unreachable", `can't reach the relay at ${this.relayUrl}: ${String(err)}`)
    }
    return { status: res.status, body: await res.json().catch(() => ({})) }
  }
}
