---
name: reject
description: Reject a pending Duoza request; the sender is told
disable-model-invocation: true
allowed-tools: Bash(node *)
argument-hint: <request number>
---
```!
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" reject <<'DUOZA_ARGS_9c41d7'
$ARGUMENTS
DUOZA_ARGS_9c41d7
```

Confirm to the user in one short line. Don't run any tools.
