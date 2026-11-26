import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"
import { SqliteStore } from "../src/store.js"

describe("SqliteStore migration", () => {
  it("opens a database created by 0.1/0.2 (pair_slots without display_name) and stores names", () => {
    const path = join(mkdtempSync(join(tmpdir(), "duoza-mig-")), "relay.sqlite")
    const old = new Database(path)
    old.exec("CREATE TABLE pair_slots (code TEXT PRIMARY KEY, initiator_id TEXT NOT NULL, expires_at INTEGER NOT NULL)")
    old.prepare("INSERT INTO pair_slots VALUES (?, ?, ?)").run("OLDCOD", "a".repeat(32), 9_999_999_999_999)
    old.close()

    const store = new SqliteStore(path)
    expect(store.claimPairSlot("OLDCOD", 1)).toEqual({ initiatorId: "a".repeat(32), displayName: null })
    expect(store.createPairSlot("NEWCOD", "b".repeat(32), 9_999_999_999_999, "Utsav")).toBe(true)
    expect(store.claimPairSlot("NEWCOD", 1)).toEqual({ initiatorId: "b".repeat(32), displayName: "Utsav" })
    store.close()
  })
})
