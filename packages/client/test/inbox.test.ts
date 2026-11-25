import { mkdirSync, mkdtempSync } from "node:fs"
import { createServer } from "node:net"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { findInbox, postInbox } from "../src/inbox.js"

function shortTmp(): string {
  // Unix socket paths are limited (~104 bytes on macOS), so keep it short.
  return mkdtempSync("/tmp/dz-")
}

async function listen(path: string): Promise<{ received: () => Promise<string>; close: () => void }> {
  let data = ""
  let done: (s: string) => void = () => {}
  const finished = new Promise<string>((resolve) => {
    done = resolve
  })
  const server = createServer((sock) => {
    sock.on("data", (c) => {
      data += String(c)
    })
    sock.on("end", () => done(data))
  })
  await new Promise<void>((resolve) => server.listen(path, resolve))
  return { received: () => finished, close: () => server.close() }
}

describe("findInbox", () => {
  it("uses CLAUDE_CODE_MESSAGING_SOCKET when it exists", async () => {
    const dir = shortTmp()
    const path = join(dir, "s.sock")
    const srv = await listen(path)
    expect(findInbox({ env: { CLAUDE_CODE_MESSAGING_SOCKET: path }, ppid: 1, uid: 501 })).toBe(path)
    expect(findInbox({ env: { CLAUDE_CODE_MESSAGING_SOCKET: `uds:${path}` }, ppid: 1, uid: 501 })).toBe(path)
    srv.close()
  })

  it("returns null when the advertised socket is gone or nothing is found", () => {
    expect(findInbox({ env: { CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/dz-nope/x.sock" }, ppid: 1, uid: 501 })).toBeNull()
    expect(findInbox({ env: {}, ppid: 999_999, uid: 501, searchDirs: [shortTmp()] })).toBeNull()
  })

  it("falls back to <dir>/<parent pid>.sock in the known socket directories", async () => {
    const dir = shortTmp()
    mkdirSync(join(dir, "cc"))
    const path = join(dir, "cc", "4242.sock")
    const srv = await listen(path)
    expect(findInbox({ env: {}, ppid: 4242, uid: 501, searchDirs: [join(dir, "cc")] })).toBe(path)
    srv.close()
  })
})

describe("postInbox", () => {
  it("writes the auth line, then one user message as a JSON line", async () => {
    const path = join(shortTmp(), "s.sock")
    const srv = await listen(path)
    await postInbox(path, "tok-123", "[duoza · msg · from Utsav]\n│ hi")
    const lines = (await srv.received()).trimEnd().split("\n")
    expect(JSON.parse(lines[0] as string)).toEqual({ type: "auth", token: "tok-123" })
    expect(JSON.parse(lines[1] as string)).toEqual({ type: "user", message: { role: "user", content: "[duoza · msg · from Utsav]\n│ hi" } })
    srv.close()
  })

  it("omits the auth line when there is no token", async () => {
    const path = join(shortTmp(), "s.sock")
    const srv = await listen(path)
    await postInbox(path, undefined, "x")
    const lines = (await srv.received()).trimEnd().split("\n")
    expect(lines).toHaveLength(1)
    srv.close()
  })

  it("rejects when nothing is listening", async () => {
    await expect(postInbox(join(shortTmp(), "missing.sock"), undefined, "x")).rejects.toThrow()
  })
})
