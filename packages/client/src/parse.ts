export type ParsedCommand =
  | { cmd: "whoami" }
  | { cmd: "context" }
  | { cmd: "set-relay"; url: string }
  /** No name: use the name they send when they join. */
  | { cmd: "request"; name?: string }
  /** No name: use the name the code's creator chose. */
  | { cmd: "pair"; name?: string; code: string }
  /** input is "[name] <text>"; the name may be several words or (with one peer) left out (Duoza.splitTarget). */
  | { cmd: "send"; input: string }
  | { cmd: "query"; input: string }
  | { cmd: "show"; number: number }
  | { cmd: "accept"; number: number }
  | { cmd: "reject"; number: number }
  | { cmd: "result"; queryId: string; text: string }
  | { cmd: "peers" }
  | { cmd: "unpair"; name?: string }
  /** No name: show the current one. */
  | { cmd: "name"; name?: string }

export type ParseResult = ParsedCommand | { error: string }

const USAGE: Record<string, string> = {
  "set-relay": "usage: /duo:setup <https://relay.example>",
  pair: "usage: /duo:join <code>   e.g. /duo:join K7P-42Q   (or /duo:join <their name> <code>)",
  send: "usage: /duo:msg [name] <message>   e.g. /duo:msg pushed the fix",
  query: "usage: /duo:ask [name] <what their Claude should do>",
  show: "usage: /duo:show <request number>",
  accept: "usage: /duo:ok <request number>",
  reject: "usage: /duo:no <request number>",
  result: "usage: duoza result <query id> <summary>",
}

/** "Gaurav Sir" -> "Gaurav_Sir": names are one word so they can lead a command. */
function joinName(words: string[]): string {
  return words.join("_")
}

/** "name rest of the text" -> [name, rest]. The rest keeps its inner whitespace and newlines. */
function headAndRest(input: string): [string, string] | null {
  const m = /^(\S+)\s+([\s\S]*\S)$/.exec(input.trim())
  return m === null ? null : [m[1] as string, m[2] as string]
}

function positiveInt(input: string): number | null {
  const t = input.trim()
  if (!/^\d{1,9}$/.test(t)) return null
  const n = Number(t)
  return n > 0 ? n : null
}

/**
 * Parses a command plus the raw text the person typed after it.
 * The text arrives on stdin (via a quoted heredoc in the skills), never through a shell,
 * so it is treated purely as data here.
 */
export function parseCommand(command: string, text: string): ParseResult {
  const usage = (): ParseResult => ({ error: USAGE[command] ?? "usage error" })
  const words = text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0)

  switch (command) {
    case "whoami":
      return { cmd: "whoami" }
    case "context":
      return { cmd: "context" }
    case "peers":
      return { cmd: "peers" }
    case "set-relay":
      return words.length === 1 ? { cmd: "set-relay", url: words[0] as string } : usage()
    case "request":
    case "unpair":
    case "name":
      return words.length >= 1 ? { cmd: command, name: joinName(words) } : { cmd: command }
    case "pair":
      if (words.length === 0) return usage()
      if (words.length === 1) return { cmd: "pair", code: words[0] as string }
      return { cmd: "pair", name: joinName(words.slice(0, -1)), code: words.at(-1) as string }
    case "send":
    case "query":
      return words.length === 0 ? usage() : { cmd: command, input: text.trim() }
    case "result": {
      const parts = headAndRest(text)
      return parts === null ? usage() : { cmd: "result", queryId: parts[0], text: parts[1] }
    }
    case "show":
    case "accept":
    case "reject": {
      const n = positiveInt(text)
      return n === null ? usage() : { cmd: command, number: n }
    }
    default:
      return {
        error: `unknown command "${command}". Commands: whoami, name, context, request, pair, send, query, show, accept, reject, result, peers, unpair, set-relay`,
      }
  }
}
