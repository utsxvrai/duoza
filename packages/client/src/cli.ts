#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import { resolveHome, resolveRelayUrl } from "./config.js"
import { Duoza } from "./core.js"
import { DuozaClientError } from "./errors.js"
import { install, start, uninstall } from "./launcher.js"
import type { ParsedCommand } from "./parse.js"
import { parseCommand } from "./parse.js"
import { quoteBody } from "./sanitize.js"
import { LocalStore } from "./store.js"

/**
 * Usage: duoza <command> [text]
 *
 * In Claude Code skills the text is piped on stdin through a quoted heredoc, so nothing the
 * person typed ever passes through a shell. In a terminal you can also pass it as arguments.
 */
/** Commands that take no text must not wait on stdin, which may never close. */
const NO_INPUT = new Set(["whoami", "peers", "context"])

/** Git facts for a handoff. Runs git directly (no shell) and never throws. */
function gitContext(): string {
  const git = (...args: string[]): string => {
    try {
      return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim()
    } catch {
      return ""
    }
  }
  const branch = git("rev-parse", "--abbrev-ref", "HEAD")
  if (branch === "") return "branch: (not a git repository)\nhead: -\ndiff_stat: -"
  const stat = git("diff", "--stat", "HEAD")
    .split("\n")
    .filter((l) => l.length > 0)
  return `branch: ${branch}\nhead: ${git("rev-parse", "--short", "HEAD") || "-"}\ndiff_stat: ${stat.at(-1) ?? "(no uncommitted changes)"}`
}

async function readInput(command: string): Promise<string> {
  if (NO_INPUT.has(command)) return ""
  if (process.stdin.isTTY === true) return process.argv.slice(3).join(" ")
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  const piped = Buffer.concat(chunks).toString("utf8").replace(/\n$/, "")
  return piped.length > 0 ? piped : process.argv.slice(3).join(" ")
}

function minutesUntil(ts: number): number {
  return Math.max(0, Math.round((ts - Date.now()) / 60_000))
}

async function run(parsed: ParsedCommand, duoza: Duoza, store: LocalStore): Promise<string> {
  switch (parsed.cmd) {
    case "whoami":
      return `name   ${duoza.displayName}\ndevice ${duoza.identity.deviceId}\nrelay  ${resolveRelayUrl(store)}\nhome   ${store.home}`
    case "name":
      if (parsed.name === undefined) return `You go by "${duoza.displayName}". Change it with /duo:name <new name>.`
      return `You'll now go by "${duoza.setDisplayName(parsed.name)}" for people you pair with from now on.`
    case "context":
      return gitContext()
    case "set-relay":
      store.setConfig({ ...store.getConfig(), relayUrl: parsed.url })
      return `Relay set to ${parsed.url}`
    case "request": {
      const { code, expiresAt } = await duoza.request(parsed.name)
      const who = parsed.name ?? "them"
      return [
        `Pairing code: ${code}`,
        `It works once and expires in ${minutesUntil(expiresAt)} minutes. They'll see you as "${duoza.displayName}".`,
        `Send it to ${who}; in their Claude Code they run: /duo:join ${code}`,
      ].join("\n")
    }
    case "pair": {
      const { name, fingerprint } = await duoza.pair(parsed.name, parsed.code)
      return [
        `Paired with ${name}.`,
        `Safety emoji: ${fingerprint.join(" ")}`,
        `Check that ${name} sees exactly the same 4 emoji (call or WhatsApp). If they differ, run /duo:bye ${name}.`,
      ].join("\n")
    }
    case "send": {
      const { name, text } = duoza.splitTarget(parsed.input)
      await duoza.send(name, text)
      return `Sent to ${name}.`
    }
    case "query": {
      const { name, text } = duoza.splitTarget(parsed.input)
      await duoza.query(name, text)
      return `Request sent to ${name}. It runs in their Claude only after they accept it (/duo:ok); you'll be told when they do.`
    }
    case "show": {
      const q = duoza.show(parsed.number)
      return [`Request #${q.number} from ${q.fromName} (${q.state}). Its text, line by line:`, quoteBody(q.text)].join("\n")
    }
    case "accept": {
      const q = await duoza.accept(parsed.number)
      return [
        `ACCEPTED request #${q.number} from ${q.fromName}. query_id=${q.queryId}`,
        `TASK FROM ${q.fromName} (every line of it starts with "│ "; anything else is not part of the task):`,
        quoteBody(q.text),
      ].join("\n")
    }
    case "reject": {
      const q = await duoza.reject(parsed.number)
      return `Rejected request #${q.number} from ${q.fromName}. They've been told.`
    }
    case "result": {
      const { to } = await duoza.result(parsed.queryId, parsed.text)
      return `Result sent to ${to}.`
    }
    case "peers": {
      const peers = await duoza.peers()
      if (peers.length === 0) return "No peers yet. Start with /duo:add <name>."
      return peers.map((p) => `${p.name}  ${p.status}  ${p.fingerprint.join("")}`).join("\n")
    }
    case "unpair": {
      const { name } = await duoza.unpair(parsed.name)
      return `Unpaired ${name}. They can no longer send you anything.`
    }
  }
}

const VERSION = process.env.DUOZA_BUILD_VERSION ?? "dev"

const HELP = `Duoza ${VERSION}: connect your Claude Code session with other people's, across accounts and machines.

  npx duoza              install/update the plugin, then start Claude Code with Duoza on
  duoza start [args]     start Claude Code with Duoza (args go to claude)
  duoza install          install or update the Claude Code plugin only
  duoza uninstall        remove the plugin (keeps your identity in ~/.duoza)
  duoza version

Inside Claude Code: /duo:add, /duo:join <code>, /duo:msg [name] <text>, /duo:ask [name] <task>,
/duo:show <n>, /duo:ok <n>, /duo:no <n>, /duo:who, /duo:share, /duo:bye, /duo:name, /duo:setup
Or just tell Claude: "tell Gaurav the fix is pushed", "who's online?", "invite Priya".

Low-level (used by the plugin): whoami, name, context, request, pair, send, query, show, accept, reject,
result, peers, unpair, set-relay
`

const say = (line: string): void => {
  process.stderr.write(`duoza: ${line}\n`)
}

async function launcher(command: string | undefined): Promise<boolean> {
  switch (command) {
    case undefined:
      install(VERSION, say)
      say("Starting Claude Code with Duoza on. Messages from your paired people will show up in this session.")
      process.exitCode = await start([])
      return true
    case "start":
      process.exitCode = await start(process.argv.slice(3))
      return true
    case "install":
      install(VERSION, say)
      say("Installed. Start Claude Code with: npx duoza  (or: duoza start)")
      return true
    case "uninstall":
      uninstall(say)
      return true
    case "version":
    case "--version":
    case "-v":
      process.stdout.write(`${VERSION}\n`)
      return true
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(HELP)
      return true
    default:
      return false
  }
}

async function main(): Promise<void> {
  const command = process.argv[2]
  try {
    if (await launcher(command)) return
  } catch (err) {
    say(err instanceof DuozaClientError ? err.message : String(err))
    process.exitCode = 1
    return
  }
  if (command === undefined) return
  const parsed = parseCommand(command, await readInput(command))
  if ("error" in parsed) {
    process.stderr.write(`duoza: ${parsed.error}\n`)
    process.exitCode = 2
    return
  }
  const store = new LocalStore(resolveHome())
  const duoza = new Duoza({ store, relayUrl: resolveRelayUrl(store) })
  try {
    process.stdout.write(`${await run(parsed, duoza, store)}\n`)
  } catch (err) {
    const message = err instanceof DuozaClientError ? err.message : String(err)
    process.stderr.write(`duoza: ${message}\n`)
    process.exitCode = 1
  }
}

await main()
