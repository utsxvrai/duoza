#!/usr/bin/env node
import { buildRelay } from "./app.js"
import { SqliteStore } from "./store.js"

const port = Number(process.env.PORT ?? 8787)
const host = process.env.HOST ?? "0.0.0.0"
const dbPath = process.env.DUOZA_RELAY_DB ?? "./duoza-relay.sqlite"

const clientIpHeader = process.env.DUOZA_CLIENT_IP_HEADER ?? null

const store = new SqliteStore(dbPath)
const app = buildRelay({ store, logger: true, clientIpHeader })

const shutdown = async (): Promise<void> => {
  await app.close()
  store.close()
  process.exit(0)
}
process.on("SIGINT", () => {
  void shutdown()
})
process.on("SIGTERM", () => {
  void shutdown()
})

await app.listen({ port, host })
