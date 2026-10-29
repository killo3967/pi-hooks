# pi-hooks

Claude Code-compatible command hooks for the Pi coding agent.

`pi-hooks` reads the `hooks` block you would write for Claude Code and runs those commands on Pi's
events: session start and end, compaction, tool calls and results, prompt submission, and the end of a
turn. A hook receives the event as JSON on stdin and answers with an exit code or with JSON on stdout.

Requires Pi **1.4.0 or newer**.

## Install

```bash
pi install git:github.com/killo3967/pi-hooks
```

Then add hooks to `.pi/settings.json` (project) or `~/.pi/agent/settings.json` (global):

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
            "command": "echo 'Commit from the terminal' >&2; exit 2"
          }
        ]
      }
    ]
  }
}
```

That hook refuses `git commit` calls: `exit 2` blocks the call and passes stderr back as the reason.

## Documentation

Full documentation lives in [`docs/`](docs/README.md), split by what you are trying to do.

| | |
|---|---|
| [Tutorial](docs/tutorials/first-hook.md) | Your first hook, end to end |
| [How-to guides](docs/how-to/install.md) | Install, develop, release, troubleshoot |
| [Reference](docs/reference/configuration.md) | Settings, matchers, hook input, hook output |
| [Explanation](docs/explanation/how-it-works.md) | Event mapping, design notes, security posture |

Worth knowing before you start:

- Hooks are **fail-open**: if a hook cannot run, the action proceeds and the failure is only reported.
  There is no switch to make a broken hook block. See [Security](docs/explanation/security.md).
- Project hooks require **project trust**: `.pi/settings.json` is not read until you approve the folder.
- Hook commands run through a shell, with the permissions of the Pi process.

## Status

This fork is the maintained version of `pi-hooks`. Upstream (`hsingjui/pi-hooks`) has had no code change
since 2026-05-08, and the npm package `@hsingjui/pi-hooks` predates the Windows shell fix. Upstream issues
and pull requests are still read as a backlog, but fixes land here.

## License

MIT — see [LICENSE](LICENSE).
