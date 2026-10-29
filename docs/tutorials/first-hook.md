# Your first hook

Ten minutes, two hooks: one that adds a reminder when a session starts, and one that refuses a tool call.

> Part of the [pi-hooks documentation](../README.md).

## What you need

- Pi **1.4.0 or newer** (`pi --version`).
- A terminal in the project where you want the hooks to apply.

## 1. Install the extension

```bash
pi install git:github.com/killo3967/pi-hooks
```

## 2. Add a hook that speaks on session start

Create `.pi/settings.json` in your project:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "printf 'Remember: tests run with pnpm test\\n'"
          }
        ]
      }
    ]
  }
}
```

Open a session in that folder. For `SessionStart`, whatever the command prints on stdout becomes hidden
context for the model, and `pi-hooks` tells you it happened.

If you see nothing, the [troubleshooting checklist](../how-to/troubleshoot.md) starts with the two
reasons that cause almost every report: the hook never ran, or its output was not JSON.

## 3. Add a hook that blocks a tool call

A `PreToolUse` hook that exits with code `2` blocks the call, and uses stderr as the reason:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "bash",
        "hooks": [
          {
            "type": "command",
            "if": "Bash(git commit*)",
            "command": "echo 'Commit from the terminal, not from the agent' >&2; exit 2"
          }
        ]
      }
    ]
  }
}
```

Ask the agent to run `git commit -m "x"` and the call is refused with that message. The same effect can be
expressed as JSON output instead of an exit code; see [hook output](../reference/hook-output.md).

## 4. Where to go next

- Need the exact field for an event read or written by a hook: [reference](../reference/configuration.md).
- Need to know why a hook of yours is not firing: [troubleshoot](../how-to/troubleshoot.md).
- Want to understand the event mapping before writing more: [how it works](../explanation/how-it-works.md).
