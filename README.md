# Duoza

**Connect your Claude Code session with someone else's, even when you're on different Claude accounts and different machines.**

Pair once with a short code. After that you can chat between sessions, send a task that runs in the other person's Claude **only after they accept it**, and hand off the context of what you were doing.

```
You                                           Your teammate
/duoza:request Priya      →  code K7P-42Q  →  /duoza:pair Utsav K7P-42Q
                    both see the same safety emoji 🐘 🌲 🐵 🌵
/duoza:msg Priya pushed the fix         →    ← duoza · Utsav: pushed the fix
/duoza:query Priya run the auth tests   →    ← request #1 (text hidden)
                                             /duoza:show 1   /duoza:accept 1
← Priya accepted · ← result: "3 failing, token expiry"   ←  their Claude does it
```

Claude Code already lets you message your *own* sessions. Duoza is for *two people*.

## Install and start

You need [Claude Code](https://code.claude.com) and Node.js 20+.

```bash
npx duoza
```

That installs the Duoza plugin into Claude Code (or updates it) and starts Claude Code with Duoza switched on. Use the same command every time you want a Duoza session; anything after `npx duoza start` is passed to `claude`, e.g. `npx duoza start --resume`.

Claude Code will show a warning that you're loading a **development channel**. Choose *"I am using this for local development"*. This appears because Claude Code channels are a research preview and Duoza isn't on Anthropic's approved channel list yet ([why](#limitations)).

## Commands (inside Claude Code)

| Command | What it does |
|---|---|
| `/duoza:request <name>` | Make a one-time pairing code (valid 10 minutes) to give to `<name>` |
| `/duoza:pair <name> <code>` | Use a code someone gave you. `<name>` is what you'll call them |
| `/duoza:msg <name> <text>` | Send a chat message. It's shown in their session; their Claude doesn't act on it |
| `/duoza:query <name> <task>` | Ask their Claude to do something. It runs only if they accept |
| `/duoza:show <n>` | Read incoming request #n before deciding |
| `/duoza:accept <n>` / `/duoza:reject <n>` | Run it here (with your normal permission prompts), or decline |
| `/duoza:handoff <name>` | Send a summary of this session: what's done, branch, diff, open questions |
| `/duoza:peers` | Who you're paired with, online status, safety emoji |
| `/duoza:unpair <name>` | Disconnect |
| `/duoza:setup <relay-url>` | Use a different (e.g. self-hosted) relay |

After pairing, **compare the 4 safety emoji over a call or chat**. If they match, nobody (including the relay) is in the middle.

## How it works

```
Your laptop                              Relay (wss)                          Their laptop
claude ─ duoza channel (MCP) ──WSS──►  pairing codes, presence,  ◄──WSS── duoza channel ─ claude
       └ /duoza:* skills ─► duoza CLI   offline mailbox (7 days)          (their own account)
~/.duoza: your keys, peers               sees only ciphertext             ~/.duoza
```

- **Identity is a keypair, not an account.** On first run Duoza creates an Ed25519 signing key and an X25519 encryption key in `~/.duoza` (mode 0600). The relay knows you only by a hash of your public key.
- **End-to-end encrypted.** Every message is sealed with NaCl `box` for the recipient. The relay stores and forwards ciphertext; the sender, recipient, message id and timestamp are also sealed inside, so the relay can't re-address or alter them, and clients drop duplicates.
- **Delivery is reliable.** Messages wait in the relay's mailbox (up to 7 days) until the other side is online and acknowledges them.
- **Events reach Claude through a [Claude Code channel](https://code.claude.com/docs/en/channels).** Only the session started with `npx duoza` receives them; other sessions don't silently consume your messages.

## Safety model

- A **request never runs without the receiver accepting it**. The notice that a request arrived doesn't contain its text, so the receiving Claude can't act on it early. Accepting runs it with the receiver's own permission settings and prompts.
- **Chat and handoffs are context, not instructions.** Claude is told to show them, not act on them.
- **Your typed text never touches a shell.** The `/duoza:*` commands pass what you type to the CLI on stdin through a quoted heredoc. (We found and fixed exactly this injection during development; see SECURITY.md.)
- Only people you've **paired with** can reach you; the relay refuses everything else. Codes are single-use, expire in 10 minutes, and guessing is rate-limited.

Read [SECURITY.md](SECURITY.md) for the full threat model and what Duoza does *not* protect against.

## Limitations

- **Development-channel warning.** Custom channels need `--dangerously-load-development-channels` until a plugin is on Anthropic's channel allowlist. `npx duoza` passes it for you.
- **Claude Team / Enterprise:** an org Owner must enable channels (`channelsEnabled`). Personal Pro/Max accounts work as-is.
- **macOS, Linux and WSL.** Native Windows isn't supported yet (the commands rely on a POSIX shell).
- Pairs only for now; groups are on the roadmap.

## Self-hosting the relay

The public relay (`https://duoza-relay.fly.dev`) is free to use. To run your own:

```bash
docker build -f Dockerfile.relay -t duoza-relay .
docker run -p 8080:8080 -v duoza-data:/data -e DUOZA_RELAY_DB=/data/duoza-relay.sqlite duoza-relay
```

Put it behind TLS, then everyone involved runs `/duoza:setup https://your-relay.example` (both people must use the same relay). A `fly.toml` is included for Fly.io.

## Uninstall

```bash
npx duoza uninstall     # removes the plugin; your keys stay in ~/.duoza
```

## Develop

```bash
npm install
npm test               # vitest: protocol, relay, client, channel, launcher
npm run lint           # biome
npm run typecheck
npm run build:plugin   # bundles plugin/dist
npm run build:npm      # assembles the npm package in release/npm
```

Packages: `packages/protocol` (crypto, envelopes, frames), `packages/relay` (Fastify + WebSocket + SQLite), `packages/client` (CLI, channel server, launcher), and `plugin/` (Claude Code plugin: skills + channel).

## License

MIT
