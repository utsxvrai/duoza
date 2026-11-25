#!/usr/bin/env node
// Entry point Claude Code spawns (stdio). stdout carries MCP; log only to stderr / the log file.
import { appendFileSync } from "node:fs"
import { join } from "node:path"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { createChannelServer } from "./channel.js"
import { resolveHome, resolveRelayUrl } from "./config.js"
import { Duoza } from "./core.js"
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

const duoza = new Duoza({ store, relayUrl: resolveRelayUrl(store) })
const handle = createChannelServer({ duoza, log })

handle.server.oninitialized = () => {
  // Diagnostic: what does Claude Code advertise when it loads this server as a channel vs. not?
  log(
    `initialized by ${JSON.stringify(handle.server.getClientVersion())} capabilities=${JSON.stringify(handle.server.getClientCapabilities())} DUOZA_CHANNEL=${process.env.DUOZA_CHANNEL ?? ""}`,
  )
  // Only the session that shows Duoza events may receive (and ack) mail. A session that loaded the
  // plugin without the channel would silently swallow messages, so listening is opt-in for now.
  if (process.env.DUOZA_CHANNEL === "1") {
    void handle.startRelay()
  } else {
    log("not listening: start Claude with DUOZA_CHANNEL=1 and --dangerously-load-development-channels plugin:duoza@duoza-local to receive events")
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
