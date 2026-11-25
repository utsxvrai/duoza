---
name: pair
description: Use a pairing code someone gave you to connect with their Claude session
disable-model-invocation: true
allowed-tools: Bash(node *)
argument-hint: <their name> <code>
---
```!
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" pair <<'DUOZA_ARGS_9c41d7'
$ARGUMENTS
DUOZA_ARGS_9c41d7
```

Show the user the output above. Stress the safety step: both people must see the same 4 emoji; if they differ, run /duoza:unpair. Don't run any tools.
