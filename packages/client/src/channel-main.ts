#!/usr/bin/env node
// Entry point Claude Code spawns (stdio). stdout carries MCP; log only to stderr / the log file.
import { appendFileSync } from "node:fs"
import { join } from "node:path"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { createChannelServer } from "./channel.js"
import { resolveHome, resolveRelayUrl } from "./config.js"
import { Duoza } from "./core.js"
import { findInbox } from "./inbox.js"
import { LocalStore } from "./store.js"

const store = new LocalStore(resolveHome())
const logFile = join(store.home, "channel.log")
const log = (line: string): void => {
  const stamped = `${new Date().toISOString()} pid=${process.pid} ${line}\n`
  process.stderr.write(`duoza: ${line}\n`)
  try {
    appendFileSync(logFile, stamped, { mode: 0o600 })
  } catch {
    /* logging must never crash the server */
  }
}

const inbox = (): { path: string; token: string | undefined } | null => {
  const path = findInbox({ env: process.env, ppid: process.ppid, uid: process.getuid?.() ?? 0 })
  return path === null ? null : { path, token: process.env.CLAUDE_CODE_MESSAGING_TOKEN }
}

const duoza = new Duoza({ store, relayUrl: resolveRelayUrl(store) })
const handle = createChannelServer({ duoza, log, inbox })

// Only the session the user started for Duoza (`npx duoza` sets DUOZA_LISTEN=1) may receive and ack mail:
// other sessions that load the plugin would otherwise compete for it. DUOZA_CHANNEL=1 is the 0.1.x name.
const listening = process.env.DUOZA_LISTEN === "1" || process.env.DUOZA_CHANNEL === "1"

handle.server.oninitialized = () => {
  const target = inbox()
  log(`initialized; listening=${listening} inbox=${target === null ? "none (channel fallback)" : target.path}`)
  if (listening) {
    void handle.startRelay()
  } else {
    log("not listening: start Claude Code with `npx duoza` (or DUOZA_LISTEN=1 claude) to receive Duoza events here")
  }
}

await handle.server.connect(new StdioServerTransport())

const shutdown = async (): Promise<void> => {
  await handle.stop()
  process.exit(0)
}
process.on("SIGINT", () => {
  void shutdown()
})
process.on("SIGTERM", () => {
  void shutdown()
})
process.stdin.on("close", () => {
  void shutdown()
})
