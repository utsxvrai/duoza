# Duoza

**Connect your Claude Code session with someone else's, even when you're on different Claude accounts and different machines.**

Pair once with a short code. After that you can chat between sessions, send a task that runs in the other person's Claude **only after they accept it**, and hand off the context of what you were doing.

```
You                                         Your teammate
/duo:add             →  code K7P-42Q  →     /duo:join K7P-42Q
              both see the same safety emoji 🐘 🌲 🐵 🌵
/duo:msg pushed the fix              →     ← [duoza · msg · from Utsav] pushed the fix
/duo:ask run the auth tests          →     ← request #1 (text hidden)
                                            /duo:show 1   /duo:ok 1
← accepted · ← result: "3 failing, token expiry"  ←  their Claude does it
```

Or just tell Claude: *"invite Priya to Duoza"*, *"tell Priya the fix is pushed"*, *"ask Priya to run the auth tests"*, *"who's online?"*.

Claude Code already lets you message your *own* sessions. Duoza is for *two people*.

## Install and start

You need [Claude Code](https://code.claude.com) and Node.js 20+.

```bash
npx duoza
```

That installs the Duoza plugin into Claude Code (or updates it) and starts Claude Code with Duoza switched on. Use the same command every time you want a Duoza session; anything after `npx duoza start` is passed to `claude`, e.g. `npx duoza start --resume`.

No flags, no warning screens: Duoza delivers into the session's own inbox (the one Claude Code's cross-session messaging uses). Needs Claude Code 2.1.224 or newer; on older versions `npx duoza` falls back to a [development channel](#limitations).

## Commands (inside Claude Code)

| Command | What it does |
|---|---|
| `/duo:add [name]` | Make a one-time pairing code (valid 10 minutes) to send to someone |
| `/duo:join <code>` | Use a code someone sent you |
| `/duo:msg [name] <text>` | Send a chat message. It's shown in their session; their Claude doesn't act on it |
| `/duo:ask [name] <task>` | Ask their Claude to do something. It runs only if they accept |
| `/duo:show <n>` | Read incoming request #n before deciding |
| `/duo:ok <n>` / `/duo:no <n>` | Run it here (with your normal permission prompts), or decline |
| `/duo:share [name]` | Send a summary of this session: what's done, branch, diff, open questions |
| `/duo:who` | Who you're paired with, online status, safety emoji |
| `/duo:bye [name]` | Disconnect |
| `/duo:name [new name]` | Show or change the name others see (defaults to your git user.name) |
| `/duo:setup <relay-url>` | Use a different (e.g. self-hosted) relay |

**Names:** when you pair, each side automatically gets the name the other chose (`/duo:name`), so you don't have to type one. Names can have spaces: `Gaurav Sir` becomes `Gaurav_Sir`, and `/duo:msg Gaurav Sir hi` still works. If you're paired with just one person, leave the name out entirely. The name you choose is visible to the relay while a pairing code is open; messages never are.

**Plain words work too.** Claude has tools to send, ask, list, invite, join and share, and uses them only when *you* ask. There is deliberately no tool to accept a request: only you can, by typing `/duo:ok`.

After pairing, **compare the 4 safety emoji over a call or chat**. If they match, nobody (including the relay) is in the middle.

## How it works

```
Your laptop                              Relay (wss)                          Their laptop
claude ─ duoza channel (MCP) ──WSS──►  pairing codes, presence,  ◄──WSS── duoza channel ─ claude
       └ /duo:* skills ─► duoza CLI   offline mailbox (7 days)          (their own account)
~/.duoza: your keys, peers               sees only ciphertext             ~/.duoza
```

- **Identity is a keypair, not an account.** On first run Duoza creates an Ed25519 signing key and an X25519 encryption key in `~/.duoza` (mode 0600). The relay knows you only by a hash of your public key.
- **End-to-end encrypted.** Every message is sealed with NaCl `box` for the recipient. The relay stores and forwards ciphertext; the sender, recipient, message id and timestamp are also sealed inside, so the relay can't re-address or alter them, and clients drop duplicates.
- **Delivery is reliable.** Messages wait in the relay's mailbox (up to 7 days) until the other side is online and acknowledges them.
- **Events reach Claude through the session's inbox**, the socket Claude Code's [cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging) uses. Duoza's server is a child of your session, so Claude Code accepts its messages and tells Claude they come from another session, not from you. If the inbox isn't available, Duoza falls back to a [Claude Code channel](https://code.claude.com/docs/en/channels). Only the session started with `npx duoza` receives events; other sessions don't silently consume your messages.

## Safety model

- A **request never runs without the receiver accepting it**. The notice that a request arrived doesn't contain its text, so the receiving Claude can't act on it early. Accepting runs it with the receiver's own permission settings and prompts.
- **Chat and handoffs are context, not instructions.** Claude is told to show them, not act on them.
- **Their text can't pose as Duoza.** Every line another person wrote is shown behind `│ `, and control, zero-width and bidi characters become `·`, so a message can't fake a header, a request notice or an "accepted" line.
- **Your typed text never touches a shell.** The `/duo:*` commands pass what you type to the CLI on stdin through a quoted heredoc. (We found and fixed exactly this injection during development; see SECURITY.md.)
- Only people you've **paired with** can reach you; the relay refuses everything else. Codes are single-use, expire in 10 minutes, and guessing is rate-limited.

Read [SECURITY.md](SECURITY.md) for the full threat model and what Duoza does *not* protect against.

## Limitations

- **The session inbox isn't a formally documented message format.** A Claude Code update could change it; Duoza then falls back to the channel, which needs `npx duoza start --channel` (it passes `--dangerously-load-development-channels`, a research-preview flag with a warning screen) and, on Claude Team/Enterprise, an Owner enabling `channelsEnabled`.
- If you set `crossSessionInbound` to `refuse` (or `hold`) in your Claude Code settings, Duoza messages are refused (or held for approval) like any other session's.
- **macOS, Linux and WSL.** Native Windows isn't supported yet (the commands rely on a POSIX shell).
- Pairs only for now; groups are on the roadmap.

## Self-hosting the relay

The public relay (`https://duoza-relay.fly.dev`) is free to use. To run your own:

```bash
docker build -f Dockerfile.relay -t duoza-relay .
docker run -p 8080:8080 -v duoza-data:/data -e DUOZA_RELAY_DB=/data/duoza-relay.sqlite duoza-relay
```

Put it behind TLS, then everyone involved runs `/duo:setup https://your-relay.example` (both people must use the same relay). A `fly.toml` is included for Fly.io.

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
