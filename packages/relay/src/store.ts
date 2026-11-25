import type { Delivery, PublicIdentity } from "@duoza/protocol"
import Database from "better-sqlite3"

export interface MailRow {
  seq: number
  delivery: Delivery
}

export type UpsertResult = "ok" | "key_conflict"

/** Persistent relay state. Only public keys and ciphertext ever land here. */
export class SqliteStore {
  private readonly db: Database.Database

  constructor(path: string) {
    this.db = new Database(path)
    this.db.pragma("journal_mode = WAL")
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        sign_pk TEXT NOT NULL,
        box_pk TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pair_slots (
        code TEXT PRIMARY KEY,
        initiator_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pairs (
        a TEXT NOT NULL,
        b TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (a, b)
      );
      CREATE TABLE IF NOT EXISTS mailbox (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        to_id TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS mailbox_to ON mailbox (to_id, seq);
    `)
  }

  /** Registers a device, or confirms it presents the same keys it registered with. */
  upsertDevice(identity: PublicIdentity, now: number): UpsertResult {
    const existing = this.getDevice(identity.deviceId)
    if (existing === null) {
      this.db
        .prepare("INSERT INTO devices (device_id, sign_pk, box_pk, created_at) VALUES (?, ?, ?, ?)")
        .run(identity.deviceId, identity.signPublicKey, identity.boxPublicKey, now)
      return "ok"
    }
    if (existing.signPublicKey !== identity.signPublicKey || existing.boxPublicKey !== identity.boxPublicKey) {
      return "key_conflict"
    }
    return "ok"
  }

  getDevice(deviceId: string): PublicIdentity | null {
    const row = this.db.prepare("SELECT device_id, sign_pk, box_pk FROM devices WHERE device_id = ?").get(deviceId) as
      | { device_id: string; sign_pk: string; box_pk: string }
      | undefined
    if (row === undefined) return null
    return { deviceId: row.device_id, signPublicKey: row.sign_pk, boxPublicKey: row.box_pk }
  }

  /** Returns false if the code is already taken (caller retries with a new one). */
  createPairSlot(code: string, initiatorId: string, expiresAt: number): boolean {
    const res = this.db.prepare("INSERT OR IGNORE INTO pair_slots (code, initiator_id, expires_at) VALUES (?, ?, ?)").run(code, initiatorId, expiresAt)
    return res.changes === 1
  }

  /** Atomically consumes a live slot. Expired or unknown codes return null. */
  claimPairSlot(code: string, now: number): string | null {
    const claim = this.db.transaction((): string | null => {
      const row = this.db.prepare("SELECT initiator_id, expires_at FROM pair_slots WHERE code = ?").get(code) as
        | { initiator_id: string; expires_at: number }
        | undefined
      if (row === undefined) return null
      this.db.prepare("DELETE FROM pair_slots WHERE code = ?").run(code)
      return row.expires_at >= now ? row.initiator_id : null
    })
    return claim()
  }

  addPair(x: string, y: string, now: number): void {
    const [a, b] = [x, y].sort() as [string, string]
    this.db.prepare("INSERT OR IGNORE INTO pairs (a, b, created_at) VALUES (?, ?, ?)").run(a, b, now)
  }

  removePair(x: string, y: string): boolean {
    const [a, b] = [x, y].sort() as [string, string]
    return this.db.prepare("DELETE FROM pairs WHERE a = ? AND b = ?").run(a, b).changes === 1
  }

  isPaired(x: string, y: string): boolean {
    const [a, b] = [x, y].sort() as [string, string]
    return this.db.prepare("SELECT 1 FROM pairs WHERE a = ? AND b = ?").get(a, b) !== undefined
  }

  peersOf(deviceId: string): string[] {
    const rows = this.db.prepare("SELECT a, b FROM pairs WHERE a = ? OR b = ?").all(deviceId, deviceId) as Array<{ a: string; b: string }>
    return rows.map((r) => (r.a === deviceId ? r.b : r.a))
  }

  enqueue(toId: string, delivery: Delivery, now: number): number {
    const res = this.db.prepare("INSERT INTO mailbox (to_id, data, created_at) VALUES (?, ?, ?)").run(toId, JSON.stringify(delivery), now)
    return Number(res.lastInsertRowid)
  }

  countPending(toId: string): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM mailbox WHERE to_id = ?").get(toId) as { n: number }
    return row.n
  }

  pending(toId: string, limit: number, notBefore = 0): MailRow[] {
    const rows = this.db
      .prepare("SELECT seq, data FROM mailbox WHERE to_id = ? AND created_at >= ? ORDER BY seq LIMIT ?")
      .all(toId, notBefore, limit) as Array<{ seq: number; data: string }>
    return rows.map((r) => ({ seq: r.seq, delivery: JSON.parse(r.data) as Delivery }))
  }

  ack(toId: string, seq: number): void {
    this.db.prepare("DELETE FROM mailbox WHERE to_id = ? AND seq = ?").run(toId, seq)
  }

  purge(mailOlderThan: number, slotsExpiredBefore: number): void {
    this.db.prepare("DELETE FROM mailbox WHERE created_at < ?").run(mailOlderThan)
    this.db.prepare("DELETE FROM pair_slots WHERE expires_at < ?").run(slotsExpiredBefore)
  }

  close(): void {
    this.db.close()
  }
}
