---
name: ask
description: Ask a paired person's Claude to do a task; it runs only after they accept it
disable-model-invocation: true
allowed-tools: Bash(node *)
argument-hint: [name] <task for their Claude>
---
```!
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" query <<'DUOZA_ARGS_9c41d7'
$ARGUMENTS
DUOZA_ARGS_9c41d7
```

Confirm to the user in one short line, based on the output above. The accept/reject and the result will arrive here later as duoza events. Don't run any tools.
