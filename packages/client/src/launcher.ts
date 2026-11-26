import { execFileSync, spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { DuozaClientError } from "./errors.js"

/** The plugin is named "duo" so its commands are short: /duo:add, /duo:msg, /duo:ok … */
export const PLUGIN_ID = "duo@duoza"
const MARKETPLACE = "duoza"
/** Earlier releases installed the same plugin under this id; it must not run alongside the new one. */
const LEGACY_PLUGIN_IDS = ["duoza@duoza"]

function isOurs(id: string): boolean {
  return id.startsWith("duo@") || id.startsWith("duoza@")
}

export interface MarketplaceInfo {
  name: string
  path?: string
}

export interface PluginInfo {
  id: string
  enabled: boolean
}

export interface ClaudeState {
  marketplaceDir: string
  marketplaces: MarketplaceInfo[]
  plugins: PluginInfo[]
  /** True when this run copied a new Duoza version into the marketplace. */
  newVersion?: boolean
}

/** The `claude …` invocations that bring this machine to "duoza installed, enabled, up to date". */
export function planInstall(state: ClaudeState): string[][] {
  const steps: string[][] = []
  for (const legacy of state.plugins) {
    if (LEGACY_PLUGIN_IDS.includes(legacy.id)) steps.push(["plugin", "uninstall", legacy.id])
  }
  const existing = state.marketplaces.find((m) => m.name === MARKETPLACE)
  let freshMarketplace = false
  if (existing === undefined) {
    steps.push(["plugin", "marketplace", "add", state.marketplaceDir])
    freshMarketplace = true
  } else if (existing.path !== state.marketplaceDir) {
    steps.push(["plugin", "marketplace", "remove", MARKETPLACE], ["plugin", "marketplace", "add", state.marketplaceDir])
    freshMarketplace = true
  } else {
    steps.push(["plugin", "marketplace", "update", MARKETPLACE])
  }
  const plugin = state.plugins.find((p) => p.id === PLUGIN_ID)
  if (plugin === undefined || freshMarketplace) {
    steps.push(["plugin", "install", PLUGIN_ID])
  } else {
    // An existing install keeps its recorded version until updated, even though it reads files in place.
    if (state.newVersion === true) steps.push(["plugin", "update", PLUGIN_ID])
    if (!plugin.enabled) steps.push(["plugin", "enable", PLUGIN_ID])
  }
  for (const other of state.plugins) {
    if (other.id !== PLUGIN_ID && !LEGACY_PLUGIN_IDS.includes(other.id) && isOurs(other.id) && other.enabled) {
      steps.push(["plugin", "disable", other.id])
    }
  }
  return steps
}

export function planUninstall(state: ClaudeState): string[][] {
  const steps: string[][] = []
  for (const p of state.plugins) {
    if (p.id === PLUGIN_ID || LEGACY_PLUGIN_IDS.includes(p.id)) steps.push(["plugin", "uninstall", p.id])
  }
  if (state.marketplaces.some((m) => m.name === MARKETPLACE)) steps.push(["plugin", "marketplace", "remove", MARKETPLACE])
  return steps
}

/** Cross-session messaging (the session inbox Duoza delivers into) arrived in Claude Code 2.1.224. */
export function hasSessionInbox(claudeVersion: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(claudeVersion.trim())
  if (m === null) return false
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (major !== 2) return major > 2
  if (minor !== 1) return minor > 1
  return patch >= 224
}

/**
 * Claude Code arguments, plus whatever the user passed. Events go into the session inbox, which needs no flag;
 * the research-preview dev channel is only the fallback (older Claude Code, or `--channel`).
 */
export function startArgs(extra: string[], claudeVersion: string): string[] {
  const forced = extra.includes("--channel")
  const rest = extra.filter((a) => a !== "--channel")
  if (forced || !hasSessionInbox(claudeVersion)) return ["--dangerously-load-development-channels", `plugin:${PLUGIN_ID}`, ...rest]
  return rest
}

/**
 * Copies the packaged marketplace to a stable directory (npx caches are temporary).
 * Returns true when it copied, i.e. on first install or a version change.
 */
export function syncMarketplace(sourceDir: string, targetDir: string, version: string): boolean {
  const versionFile = join(targetDir, "VERSION")
  if (existsSync(versionFile) && readFileSync(versionFile, "utf8").trim() === version) return false
  mkdirSync(dirname(targetDir), { recursive: true, mode: 0o700 })
  const staging = `${targetDir}.staging-${process.pid}`
  cpSync(sourceDir, staging, { recursive: true, force: true })
  writeFileSync(join(staging, "VERSION"), `${version}\n`)
  const previous = `${targetDir}.old-${process.pid}`
  if (existsSync(targetDir)) renameSync(targetDir, previous)
  renameSync(staging, targetDir)
  rmSync(previous, { recursive: true, force: true })
  return true
}

// ---- side-effecting parts (exercised manually / in the npm smoke test) ---------------

export function defaultMarketplaceDir(): string {
  return join(homedir(), ".duoza", "marketplace")
}

/** Where the marketplace ships inside the npm package: <pkg>/marketplace next to <pkg>/bin. */
export function packagedMarketplaceDir(): string {
  return process.env.DUOZA_MARKETPLACE_SRC ?? join(dirname(fileURLToPath(import.meta.url)), "..", "marketplace")
}

function claude(args: string[]): string {
  try {
    return execFileSync("claude", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  } catch (err) {
    const e = err as { code?: string; stderr?: string; message: string }
    if (e.code === "ENOENT") {
      throw new DuozaClientError("not_found", "Claude Code isn't installed (no `claude` on PATH). Install it first: https://code.claude.com")
    }
    throw new DuozaClientError("relay_error", `claude ${args.join(" ")} failed: ${(e.stderr ?? e.message).trim()}`)
  }
}

export function readClaudeState(marketplaceDir: string): ClaudeState {
  const marketplaces = (JSON.parse(claude(["plugin", "marketplace", "list", "--json"])) as Array<{ name: string; path?: string }>).map((m) =>
    m.path === undefined ? { name: m.name } : { name: m.name, path: m.path },
  )
  const plugins = (JSON.parse(claude(["plugin", "list", "--json"])) as Array<{ id: string; enabled?: boolean }>).map((p) => ({
    id: p.id,
    enabled: p.enabled !== false,
  }))
  return { marketplaceDir, marketplaces, plugins }
}

export function assertNodeVersion(): void {
  const major = Number(process.versions.node.split(".")[0])
  if (major < 20) throw new DuozaClientError("not_found", `Duoza needs Node.js 20 or newer (you have ${process.versions.node})`)
}

export function install(version: string, log: (line: string) => void): void {
  assertNodeVersion()
  const target = defaultMarketplaceDir()
  const newVersion = syncMarketplace(packagedMarketplaceDir(), target, version)
  if (newVersion) log(`Copied Duoza ${version} to ${target}`)
  for (const step of planInstall({ ...readClaudeState(target), newVersion })) {
    log(`claude ${step.join(" ")}`)
    claude(step)
  }
}

export function uninstall(log: (line: string) => void): void {
  for (const step of planUninstall(readClaudeState(defaultMarketplaceDir()))) {
    log(`claude ${step.join(" ")}`)
    claude(step)
  }
  log("Removed the Duoza plugin. Your identity and pairings stay in ~/.duoza (delete that folder to forget them).")
}

/** Launches Claude Code as the session that receives Duoza events; resolves with Claude's exit code. */
export async function start(extra: string[]): Promise<number> {
  const version = claude(["--version"])
  const child = spawn("claude", startArgs(extra, version), { stdio: "inherit", env: { ...process.env, DUOZA_LISTEN: "1" } })
  return await new Promise((resolve, reject) => {
    child.on("error", (err) => {
      reject(new DuozaClientError("not_found", `couldn't start Claude Code: ${err.message}`))
    })
    child.on("exit", (code) => {
      resolve(code ?? 0)
    })
  })
}
