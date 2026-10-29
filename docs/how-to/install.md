# Quick Setup

> Part of the [pi-hooks documentation](../README.md). Install the extension and add your first hook.


1. Install the package:

```bash
pi install git:github.com/killo3967/pi-hooks
```

2. Add hooks to `.pi/settings.json` (or `~/.pi/agent/settings.json`):

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo 'agent finished'"
          }
        ]
      }
    ]
  }
}
```

3. Run `/reload`, then send a message to test it.

## As a Pi package


```bash
pi install git:github.com/killo3967/pi-hooks
```

The upstream npm package `@hsingjui/pi-hooks` still exists but is a stale snapshot without the
Windows shell fix; it is not the maintained version.
