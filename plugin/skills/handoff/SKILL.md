---
name: handoff
description: Send a context handoff (summary, branch, diff, open questions) of this session to a paired person
disable-model-invocation: true
allowed-tools: Bash(node *)
argument-hint: <name>
---
Repository state, read before you saw this prompt:

```!
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" context
```

The user wants to hand off this session's context to the paired person named here: $ARGUMENTS

Write the handoff from this conversation:
- summary: what was being worked on, what's done, key decisions and why, and the current state. A few short paragraphs at most.
- open_questions: what's unresolved or what the other person should look at first.
- Never include secrets, credentials, tokens, or private personal data.

Call the `duoza_handoff` tool with peer set to that name, the summary, open_questions, and branch / head_sha / diff_stat taken from the repository state above (use "" where it shows "-"). Then tell the user in one line that it was sent.
