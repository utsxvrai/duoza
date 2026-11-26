---
name: who
description: List the people you're paired with, whether they're online, and their safety emoji
disable-model-invocation: true
allowed-tools: Bash(node *)
---
```!
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" peers
```

Show the user the list above as a small table (name, status, safety emoji). Don't run any tools.
