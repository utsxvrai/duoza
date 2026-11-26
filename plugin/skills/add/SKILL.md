---
name: add
description: Create a one-time pairing code for someone you want to connect your Claude session with
disable-model-invocation: true
allowed-tools: Bash(node *)
argument-hint: [their name]
---
```!
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" request <<'DUOZA_ARGS_9c41d7'
$ARGUMENTS
DUOZA_ARGS_9c41d7
```

Show the user the output above, keeping the code exactly as printed. Tell them to send the code to that person (WhatsApp, call, anything) and that they'll see a "paired" notice here once it's used. Don't run any tools.
