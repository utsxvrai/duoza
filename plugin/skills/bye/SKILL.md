---
name: bye
description: Disconnect from a paired person; they can no longer message you
disable-model-invocation: true
allowed-tools: Bash(node *)
argument-hint: [name]
---
```!
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" unpair <<'DUOZA_ARGS_9c41d7'
$ARGUMENTS
DUOZA_ARGS_9c41d7
```

Confirm to the user in one short line. Don't run any tools.
