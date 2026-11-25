export type ParsedCommand =
  | { cmd: "whoami" }
  | { cmd: "context" }
  | { cmd: "set-relay"; url: string }
  | { cmd: "request"; name: string }
  | { cmd: "pair"; name: string; code: string }
  | { cmd: "send"; name: string; text: string }
  | { cmd: "query"; name: string; text: string }
  | { cmd: "show"; number: number }
  | { cmd: "accept"; number: number }
  | { cmd: "reject"; number: number }
  | { cmd: "result"; queryId: string; text: string }
  | { cmd: "peers" }
  | { cmd: "unpair"; name: string }

export type ParseResult = ParsedCommand | { error: string }

const USAGE: Record<string, string> = {
  "set-relay": "usage: duoza set-relay <https://relay.example>",
  request: "usage: duoza request <name>",
  pair: "usage: duoza pair <their name> <code>",
  send: "usage: duoza send <name> <message>",
  query: "usage: duoza query <name> <what their Claude should do>",
  show: "usage: duoza show <request number>",
  accept: "usage: duoza accept <request number>",
  reject: "usage: duoza reject <request number>",
  result: "usage: duoza result <query id> <summary>",
  unpair: "usage: duoza unpair <name>",
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
      return words.length === 1 ? { cmd: command, name: words[0] as string } : usage()
    case "pair":
      return words.length === 2 ? { cmd: "pair", name: words[0] as string, code: words[1] as string } : usage()
    case "send":
    case "query": {
      const parts = headAndRest(text)
      return parts === null ? usage() : { cmd: command, name: parts[0], text: parts[1] }
    }
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
        error: `unknown command "${command}". Commands: whoami, context, request, pair, send, query, show, accept, reject, result, peers, unpair, set-relay`,
      }
  }
}
