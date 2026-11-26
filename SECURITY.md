# Security

Duoza lets another person put text into your Claude Code session and, if you accept, have your Claude act on it. This document says what protects you and what doesn't.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository instead of a public issue. Include steps to reproduce. We aim to reply within a few days.

## What Duoza protects against

| Threat | Protection |
|---|---|
| The relay (or anyone on the network) reading messages | End-to-end encryption with NaCl `box` (X25519 + XSalsa20-Poly1305). The relay only stores ciphertext. |
| The relay re-addressing, re-stamping or swapping messages | The sender, recipient, id and timestamp are sealed inside the ciphertext and checked on open. |
| Someone impersonating your peer | Messages authenticate with the peer's key from pairing; the relay also checks that a connection owns the device key it claims (signed challenge). |
| A relay or attacker in the middle during pairing | Both people see a 4-emoji fingerprint derived from both keys. If they differ, unpair. (24 bits: a check for humans, not a substitute for a long fingerprint.) |
| Strangers messaging you | The relay refuses to forward between devices that never paired. Your client also drops anything from unknown devices. |
| Guessing a pairing code | Codes are 6 characters from a 31-character alphabet, single-use, valid 10 minutes, and claim attempts are rate-limited per IP. |
| A request running without consent | The receiving session gets only "request #n arrived". The text is revealed by `/duo:show` and runs only via `/duo:ok`, which you type yourself (`disable-model-invocation` keeps Claude from invoking these skills). |
| Shell injection through what you type | Skill arguments reach the CLI on stdin via a quoted heredoc; they are never interpolated into a shell command. An earlier design passed `$ARGUMENTS` on the command line and was injectable (`hi; echo INJECTED` executed); this was found in testing and replaced. |
| A session silently swallowing messages | Only a session started with `DUOZA_LISTEN=1` (what `npx duoza` does) receives and acknowledges mail. |
| A message impersonating Duoza or the user | Peer text is always rendered behind `│ ` with control, format and bidi characters shown as `·`; only Duoza's own lines are flush left. Events go through Claude Code's session inbox, which labels them as coming from another session, never as the user's own words or approval. |
| Flooding the relay | Per-IP limits on pairing codes and open connections, per-device message rate limits, mailbox caps and a 7-day TTL. |

## What Duoza does NOT protect against

- **A request you accept is a prompt from another person.** Read it with `/duo:show` first. Your Claude Code permission prompts still apply, and Duoza tells Claude to confirm destructive or outward-facing actions, but an accepted request is ultimately you choosing to run someone else's instructions.
- **Chat messages and handoffs are untrusted text** in your Claude's context. Claude is instructed not to act on them, but instructions to a model are not a security boundary. Only pair with people you trust.
- **Metadata is visible to the relay:** which device IDs are paired, when they're online, and when and how large messages are.
- **A compromised laptop** exposes `~/.duoza` (your private keys, peers and request history).
- **Results you send back** (`duoza_result`, handoffs) contain whatever your Claude writes. Claude is told to leave secrets out; check sensitive work before accepting.

## Data the public relay stores

Public keys and device IDs, which devices are paired, and undelivered encrypted messages (deleted when acknowledged, or after 7 days). Request logs (IP, path, status) are kept by the host for operations. No account, email or message content is stored.
