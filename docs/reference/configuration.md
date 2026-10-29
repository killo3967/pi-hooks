# Configuration Format

> Part of the [pi-hooks documentation](../README.md). Settings file shape, merge rules and source layout.


Configure hooks in `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Session started'"
          }
        ]
      },
      {
        "matcher": "resume",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Session resumed'"
          }
        ]
      },
      {
        "matcher": "compact",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Context compacted'"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Session ended on shutdown/exit'"
          }
        ]
      }
    ]
  }
}
```

## Project Structure


Source code lives in `src/`:

- `src/pi-hooks.ts` - extension entry point
- `src/config.ts` - config loading and merging
- `src/executor.ts` - command hook executor
- `src/hooks/shared.ts` - shared parsing and execution helpers
- `src/hooks/session-hooks.ts` - `SessionStart` / `SessionEnd`
- `src/hooks/compact-hooks.ts` - `PreCompact` / `PostCompact`
- `src/hooks/prompt-hooks.ts` - `UserPromptSubmit`
- `src/hooks/tool-hooks.ts` - `PreToolUse` / `PostToolUse` / `PostToolUseFailure`
- `src/hooks/stop-hooks.ts` - `Stop`
- `src/types.ts` - type definitions
- `test/` - `node:test` suites, one file per module under `src/`
