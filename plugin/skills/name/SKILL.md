---
name: name
description: Show or change the name you go by in Duoza (people you pair with see it)
disable-model-invocation: true
allowed-tools: Bash(node *)
argument-hint: [new name]
---
```!
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" name <<'DUOZA_ARGS_9c41d7'
$ARGUMENTS
DUOZA_ARGS_9c41d7
```

Tell the user the result above in one line. Don't run any tools.
