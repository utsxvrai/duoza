import { execFileSync } from "node:child_process"
import { userInfo } from "node:os"

/**
 * Turns anything a person might call themselves into a Duoza name: one word of letters, marks, digits,
 * _ or -, at most 32 characters ("Gaurav Sir" -> "Gaurav_Sir"). Null when nothing usable is left.
 */
export function toDisplayName(raw: string): string | null {
  const name = raw
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{M}\p{N}_-]/gu, "")
    .slice(0, 32)
  return name.length > 0 ? name : null
}

/** git's user.name, else the OS username, else "friend". Runs git directly (no shell) and never throws. */
export function defaultDisplayName(): string {
  try {
    const gitName = execFileSync("git", ["config", "--global", "user.name"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 })
    const fromGit = toDisplayName(gitName)
    if (fromGit !== null) return fromGit
  } catch {
    /* no git or no user.name */
  }
  try {
    const fromOs = toDisplayName(userInfo().username)
    if (fromOs !== null) return fromOs
  } catch {
    /* no passwd entry */
  }
  return "friend"
}
