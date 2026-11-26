import { homedir } from "node:os"
import { join } from "node:path"
import type { LocalStore } from "./store.js"

/** Public relay (Fly.io, Singapore). Override with DUOZA_RELAY_URL or `/duo:setup <url>` to self-host. */
export const DEFAULT_RELAY_URL = "https://duoza-relay.fly.dev"

export function resolveHome(): string {
  return process.env.DUOZA_HOME ?? join(homedir(), ".duoza")
}

export function resolveRelayUrl(store: LocalStore): string {
  return process.env.DUOZA_RELAY_URL ?? store.getConfig().relayUrl ?? DEFAULT_RELAY_URL
}
