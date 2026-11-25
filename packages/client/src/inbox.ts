import { existsSync } from "node:fs"
import { connect } from "node:net"
import { join } from "node:path"

/**
 * Delivery into the Claude Code session's own inbox socket, the one its cross-session messaging uses.
 * Claude Code exports the socket path and a per-session token to its child processes (our MCP server is one),
 * and delivers messages from its own children without a dev-channel flag. The line format isn't formally
 * documented, so callers fall back to a channel notification when this fails.
 */

export interface InboxLookup {
  env: Record<string, string | undefined>
  /** The session's pid: this server's parent. */
  ppid: number
  uid: number
  /** Override the directories scanned for <ppid>.sock (tests). */
  searchDirs?: string[]
}

export function findInbox(lookup: InboxLookup): string | null {
  const advertised = lookup.env.CLAUDE_CODE_MESSAGING_SOCKET
  if (advertised !== undefined && advertised !== "") {
    const path = advertised.replace(/^uds:/, "")
    return existsSync(path) ? path : null
  }
  const dirs = lookup.searchDirs ?? [
    lookup.env.XDG_RUNTIME_DIR === undefined ? null : join(lookup.env.XDG_RUNTIME_DIR, "cc-socks"),
    `/run/user/${lookup.uid}/cc-socks`,
    "/tmp/cc-socks",
    `/tmp/cc-socks-${lookup.uid}`,
    lookup.env.TMPDIR === undefined ? null : join(lookup.env.TMPDIR, `cc-socks-${lookup.uid}`),
  ]
  for (const dir of dirs) {
    if (dir === null) continue
    const path = join(dir, `${lookup.ppid}.sock`)
    if (existsSync(path)) return path
  }
  return null
}

/** One connection per message, opened only once the message is complete. Resolves when it was handed over. */
export async function postInbox(path: string, token: string | undefined, content: string, timeoutMs = 5000): Promise<void> {
  const auth = token === undefined || token === "" ? "" : `${JSON.stringify({ type: "auth", token })}\n`
  const line = `${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`
  await new Promise<void>((resolve, reject) => {
    const sock = connect(path)
    const timer = setTimeout(() => {
      sock.destroy()
      reject(new Error("inbox did not accept the message in time"))
    }, timeoutMs)
    sock.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
    sock.on("connect", () => {
      sock.end(auth + line, () => {
        clearTimeout(timer)
        resolve()
      })
    })
  })
}
