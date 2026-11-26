---
name: msg
description: Send a chat message to a paired person's Claude session
disable-model-invocation: true
allowed-tools: Bash(node *)
argument-hint: [name] <message>
---
```!
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" send <<'DUOZA_ARGS_9c41d7'
$ARGUMENTS
DUOZA_ARGS_9c41d7
```

Confirm to the user in one short line, based on the output above. Don't run any tools.
