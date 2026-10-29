# Current Support

> Part of the [pi-hooks documentation](../README.md). How Pi events map to Claude Code hooks, and the design notes.


- Only `type: "command"` is supported
- Supports the `if` field on individual hook handlers for tool events only
- Supported events:
  - `SessionStart`
  - `SessionEnd`
  - `PreCompact`
  - `PostCompact`
  - `PreToolUse`
  - `PostToolUse`
  - `PostToolUseFailure`
  - `UserPromptSubmit`
  - `Stop`
- Not supported: `http`, `prompt`, `agent`

## Event Mapping


- `SessionStart.startup` → `session_start(reason="startup")`
- `SessionStart.startup` → `session_start(reason="new")`
- `SessionStart.resume` → `session_start(reason="resume")`
- `SessionStart.compact` → `session_compact`
- `SessionEnd.other` → `session_shutdown`
- `Stop` → `agent_end` (best-effort emulation of Claude Code's “after response completes” behavior)
- `PreCompact.manual` / `PreCompact.auto` → `session_before_compact`
- `PostCompact.manual` / `PostCompact.auto` → `session_compact`

For the compaction events, `auto` covers Pi's own `threshold` (context pressure) and `overflow` (the
request did not fit) reasons, so a hook with `"matcher": "auto"` fires on both.

## Notes


- Hook commands run in the current session `cwd`
- Global config and project config are merged by concatenating event arrays
- `PostToolUse` and `PostToolUseFailure` support Pi result patching
- Input/output aims to be Claude Code-compatible where possible; anything that cannot be mapped exactly is handled in a best-effort way using Pi's event model
- Requires `@earendil-works/pi-coding-agent` **>= 1.4.0** (declared as a peer dependency, and the version the sources are type-checked against)
- Hidden context is injected through the `pi` instance captured when the extension loads; Pi invalidates a captured `pi` after a session replacement, and that path is a known limitation rather than a guarded error

## Credits

The platform-aware shell resolution — settings `shellPath`, then the known Git Bash/MSYS2 locations, then
`COMSPEC`/`cmd.exe` — was contributed by [@KedraVt](https://github.com/KedraVt) in
[upstream PR #6](https://github.com/hsingjui/pi-hooks/pull/6). It supersedes upstream PR #4: both change
the same lines of `src/executor.ts`, so they are not meant to be merged together.

The extension itself started as `hsingjui/pi-hooks`; see the [status section](../../README.md#status) for
why this fork carries the maintained version.
