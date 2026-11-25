---
name: setup
description: Point Duoza at a relay server (both people must use the same relay) and show this device's identity
disable-model-invocation: true
allowed-tools: Bash(node *)
argument-hint: <relay url>
---
```!
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" set-relay <<'DUOZA_ARGS_9c41d7'
$ARGUMENTS
DUOZA_ARGS_9c41d7
```

```!
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" whoami
```

Show the user the output above. Tell them to restart Claude Code so the background listener picks up the new relay. Don't run any tools.
