import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Identity, PublicIdentity } from "@duoza/protocol"
import { generateIdentity } from "@duoza/protocol"
import { DuozaClientError } from "./errors.js"

export interface Peer {
  name: string
  identity: PublicIdentity
  pairedAt: number
}

export type InboundQueryState = "pending" | "accepted" | "rejected" | "done"

export interface InboundQuery {
  number: number
  queryId: string
  from: string
  text: string
  receivedAt: number
  state: InboundQueryState
}

export interface OutboundQuery {
  queryId: string
  to: string
  text: string
  sentAt: number
}

interface QueriesFile {
  next: number
  inbound: InboundQuery[]
  outbound: OutboundQuery[]
}

interface PendingPair {
  code: string
  name: string
  expiresAt: number
}

export interface ClientConfig {
  relayUrl?: string
}

const NAME_RE = /^[\p{L}\p{M}\p{N}_-]{1,32}$/u
const SEEN_CAP = 2000
const OUTBOUND_CAP = 500

/**
 * Everything Duoza keeps on this machine, as small JSON files under DUOZA_HOME (default ~/.duoza).
 * Directory 0700, files 0600, writes are atomic (temp file + rename).
 */
export class LocalStore {
  constructor(readonly home: string) {
    mkdirSync(home, { recursive: true, mode: 0o700 })
    chmodSync(home, 0o700)
  }

  // ---- identity ----------------------------------------------------------------

  loadOrCreateIdentity(): Identity {
    const existing = this.read<Identity | null>("identity.json", null)
    if (existing !== null) return existing
    const identity = generateIdentity()
    this.write("identity.json", identity)
    return identity
  }

  getConfig(): ClientConfig {
    return this.read<ClientConfig>("config.json", {})
  }

  setConfig(config: ClientConfig): void {
    this.write("config.json", config)
  }

  // ---- peers -------------------------------------------------------------------

  assertValidName(name: string): void {
    if (!NAME_RE.test(name)) {
      throw new DuozaClientError("invalid_name", `"${name}" isn't a valid name: use 1-32 letters, digits, _ or -`)
    }
  }

  listPeers(): Peer[] {
    return this.read<Peer[]>("peers.json", [])
  }

  findPeer(name: string): Peer | null {
    const key = name.toLocaleLowerCase()
    return this.listPeers().find((p) => p.name.toLocaleLowerCase() === key) ?? null
  }

  findPeerByDevice(deviceId: string): Peer | null {
    return this.listPeers().find((p) => p.identity.deviceId === deviceId) ?? null
  }

  addPeer(name: string, identity: PublicIdentity, now: number): Peer {
    this.assertValidName(name)
    if (this.findPeer(name) !== null) {
      throw new DuozaClientError("name_taken", `you already have a peer called "${name}"`)
    }
    const sameDevice = this.findPeerByDevice(identity.deviceId)
    if (sameDevice !== null) {
      throw new DuozaClientError("already_paired", `that device is already paired as "${sameDevice.name}"`)
    }
    const peer: Peer = { name, identity, pairedAt: now }
    this.write("peers.json", [...this.listPeers(), peer])
    return peer
  }

  removePeer(name: string): void {
    const key = name.toLocaleLowerCase()
    this.write(
      "peers.json",
      this.listPeers().filter((p) => p.name.toLocaleLowerCase() !== key),
    )
  }

  // ---- pairing codes I handed out ----------------------------------------------

  addPendingPair(code: string, name: string, expiresAt: number): void {
    const others = this.read<PendingPair[]>("pending-pairs.json", []).filter((p) => p.code !== code)
    this.write("pending-pairs.json", [...others, { code, name, expiresAt }])
  }

  hasPendingPairFor(name: string, now: number): boolean {
    const key = name.toLocaleLowerCase()
    return this.read<PendingPair[]>("pending-pairs.json", []).some((p) => p.name.toLocaleLowerCase() === key && p.expiresAt >= now)
  }

  /** Consumes the code and returns the nickname it was created for, if still valid. */
  takePendingPair(code: string, now: number): string | null {
    const all = this.read<PendingPair[]>("pending-pairs.json", [])
    const hit = all.find((p) => p.code === code)
    this.write(
      "pending-pairs.json",
      all.filter((p) => p.code !== code && p.expiresAt >= now),
    )
    if (hit === undefined || hit.expiresAt < now) return null
    return hit.name
  }

  // ---- queries -------------------------------------------------------------------

  addInboundQuery(q: { queryId: string; from: string; text: string; receivedAt: number }): number {
    const file = this.queries()
    const existing = file.inbound.find((x) => x.queryId === q.queryId)
    if (existing !== undefined) return existing.number
    const number = file.next
    file.inbound.push({ ...q, number, state: "pending" })
    file.next = number + 1
    this.write("queries.json", file)
    return number
  }

  getInboundQuery(number: number): InboundQuery | null {
    return this.queries().inbound.find((q) => q.number === number) ?? null
  }

  findInboundQueryById(queryId: string): InboundQuery | null {
    return this.queries().inbound.find((q) => q.queryId === queryId) ?? null
  }

  setInboundQueryState(number: number, state: InboundQueryState): void {
    const file = this.queries()
    const q = file.inbound.find((x) => x.number === number)
    if (q === undefined) throw new DuozaClientError("not_found", `no request #${number}`)
    q.state = state
    this.write("queries.json", file)
  }

  addOutboundQuery(q: OutboundQuery): void {
    const file = this.queries()
    file.outbound = [...file.outbound, q].slice(-OUTBOUND_CAP)
    this.write("queries.json", file)
  }

  findOutboundQuery(queryId: string): OutboundQuery | null {
    return this.queries().outbound.find((q) => q.queryId === queryId) ?? null
  }

  // ---- dedupe --------------------------------------------------------------------

  /** True the first time an envelope id is seen. */
  markSeen(id: string): boolean {
    const seen = this.read<string[]>("seen.json", [])
    if (seen.includes(id)) return false
    this.write("seen.json", [...seen, id].slice(-SEEN_CAP))
    return true
  }

  // ---- file helpers --------------------------------------------------------------

  private queries(): QueriesFile {
    return this.read<QueriesFile>("queries.json", { next: 1, inbound: [], outbound: [] })
  }

  private read<T>(file: string, fallback: T): T {
    const path = join(this.home, file)
    if (!existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, "utf8")) as T
  }

  private write(file: string, value: unknown): void {
    const path = join(this.home, file)
    const tmp = `${path}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 })
    renameSync(tmp, path)
  }
}
