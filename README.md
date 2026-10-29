# pi-hooks

> **Maintained fork.** This repository is the maintained version of `pi-hooks`. Upstream
> (`hsingjui/pi-hooks`) has had no code change since **2026-05-08**, and the npm package
> `@hsingjui/pi-hooks` (0.0.2) predates the Windows shell fix for
> [#3](https://github.com/hsingjui/pi-hooks/issues/3). Install from this repository:
>
> ```bash
> pi install git:github.com/killo3967/pi-hooks
> ```
>
> `main` includes the platform-aware shell resolution contributed by
> [@KedraVt](https://github.com/KedraVt) in [PR #6](https://github.com/hsingjui/pi-hooks/pull/6):
> settings `shellPath` → known Git Bash/MSYS2 paths → `COMSPEC`/`cmd.exe`. It supersedes
> [PR #4](https://github.com/hsingjui/pi-hooks/pull/4), which changes the same lines of
> `src/executor.ts` and is not meant to be merged together.
>
> Upstream issues and pull requests are still read as a backlog, but fixes land here.

Claude Code-compatible command hooks for the Pi coding agent.

This package adapts Claude Code's hook configuration format to Pi's extension event system so existing command hook workflows can be reused with minimal changes.

## Quick Setup

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

## Current Support

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

## Configuration Format

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

## `matcher` Behavior

To stay aligned with Claude Code, `matcher` is a **single regex string**.

- Omitted `matcher` means match everything
- `""` means match everything
- `"*"` means match everything
- Any other value is treated as a regular expression
- If the regex is invalid, it falls back to exact string matching

Example:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "bash",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'bash only'"
          }
        ]
      },
      {
        "matcher": "write|edit",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'write or edit'"
          }
        ]
      }
    ]
  }
}
```

Event-specific matching fields:

### SessionStart

Matches `source`:

- `startup`
- `resume`
- `compact`

### SessionEnd

Matches `reason`:

- `other`

### PreToolUse / PostToolUse / PostToolUseFailure

Matches `tool_name`.

Note: this uses Pi's raw tool names directly, so names are usually lowercase, for example:

- `bash`
- `read`
- `write`
- `edit`
- `grep`
- `find`
- `ls`
- `mcp__.*`

Notes:

- `SessionEnd` is triggered from `session_shutdown`
- When `matcher` is omitted, it defaults to `other` for `SessionEnd`
- `UserPromptSubmit` and `Stop` do not support `matcher`; if provided, it is ignored

## `if` Conditions

Following Claude Code's approach, `if` is configured on each individual hook handler and only works for tool events:

- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`

If `if` is set on other event types, that hook will not run.

Currently supported forms:

- `Bash(git *)`
- `bash(git *)`
- `Edit(*.ts)`
- `Write(*.md)`
- `mcp__memory__create_entities(*)`

Rules:

- `if` syntax is `ToolName(pattern)`
- `ToolName` is compared case-insensitively
- `pattern` uses simple wildcard matching where `*` means any string
- `bash` mainly matches `tool_input.command`
- `read`, `write`, and `edit` mainly match `tool_input.path` (or `file_path`)
- Other tools first try common primary fields, then fall back to the JSON string of `tool_input`

Example: block only `git push`

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "bash",
        "hooks": [
          {
            "type": "command",
            "if": "Bash(git push*)",
            "command": "printf '%s\n' '{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"git push is blocked\"}}'"
          }
        ]
      }
    ]
  }
}
```

## Hook Input

Input fields are designed to be as close as possible to Claude Code hooks:

- Common fields: `session_id`, `transcript_path`, `cwd`, `hook_event_name`
- Event-specific fields such as `source`, `reason`, `tool_name`, `tool_input`, `tool_response`
- **Pi-specific extra fields may also be included**, but they should not break Claude Code-style scripts

### SessionStart

```json
{
  "session_id": "session-file-path",
  "transcript_path": "/path/to/session.jsonl",
  "cwd": "/current/working/directory",
  "hook_event_name": "SessionStart",
  "source": "startup"
}
```

### SessionEnd

```json
{
  "session_id": "session-file-path",
  "transcript_path": "/path/to/session.jsonl",
  "cwd": "/current/working/directory",
  "hook_event_name": "SessionEnd",
  "reason": "other"
}
```

### UserPromptSubmit

```json
{
  "session_id": "session-file-path",
  "transcript_path": "/path/to/session.jsonl",
  "cwd": "/current/working/directory",
  "hook_event_name": "UserPromptSubmit",
  "prompt": "Write a function to calculate the factorial of a number"
}
```

Notes:

- `UserPromptSubmit` does not support `matcher`; if configured, it is ignored
- It runs after the user submits input and before the agent loop starts

### Stop

Mapped from Pi's `agent_end` event.

```json
{
  "session_id": "session-file-path",
  "transcript_path": "/path/to/session.jsonl",
  "cwd": "/current/working/directory",
  "hook_event_name": "Stop",
  "stop_hook_active": false,
  "last_assistant_message": "I have completed the task."
}
```

Notes:

- `Stop` runs after the current agent turn finishes
- `Stop` does not support `matcher`; if configured, it is ignored
- `stop_hook_active` indicates whether the current continuation was triggered by a previous `Stop` hook
- `last_assistant_message` tries to extract the last assistant text content; if none exists, it is an empty string
- When `decision: "block"` is returned, the extension best-effort simulates Claude Code's “prevent stopping and continue” behavior by injecting hidden context and starting another agent turn

### PreToolUse

Mapped from Pi's `tool_call` event.

```json
{
  "session_id": "session-file-path",
  "transcript_path": "/path/to/session.jsonl",
  "cwd": "/current/working/directory",
  "hook_event_name": "PreToolUse",
  "tool_name": "bash",
  "tool_input": {
    "command": "ls -la"
  },
  "tool_use_id": "toolu_123"
}
```

Notes:

- `PreToolUse` runs before the tool actually executes
- It maps to Pi's `tool_call`, not `tool_execution_start`
- `matcher` is supported and is applied to `tool_name`
- `permission_mode` is not included
- `tool_name` uses Pi's original event value without case conversion
- `tool_input` comes from `tool_call.event.input`
- `tool_use_id` comes from `tool_call.event.toolCallId`

### PostToolUse

Mapped from Pi's `tool_result` event and only fired when the tool succeeds.

```json
{
  "session_id": "session-file-path",
  "transcript_path": "/path/to/session.jsonl",
  "cwd": "/current/working/directory",
  "hook_event_name": "PostToolUse",
  "tool_name": "bash",
  "tool_input": {
    "command": "pwd"
  },
  "tool_response": {
    "content": [
      {
        "type": "text",
        "text": "/tmp/project"
      }
    ],
    "details": {},
    "is_error": false,
    "output": "/tmp/project"
  },
  "tool_use_id": "toolu_123"
}
```

Notes:

- `PostToolUse` runs after successful tool execution
- It maps to Pi's `tool_result`
- `permission_mode` is not included
- `tool_name` uses Pi's original event value without case conversion
- `tool_input` comes from `tool_result.event.input`
- `tool_response` is the Claude Code-style compatible tool result object
- `tool_use_id` comes from `tool_result.event.toolCallId`
- Failed tool results are routed to `PostToolUseFailure` instead of `PostToolUse`

## Hook Output

### UserPromptSubmit: block the prompt or inject extra context

```json
{
  "decision": "block",
  "reason": "Explanation for decision",
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "My additional context here"
  }
}
```

Notes:

- For `UserPromptSubmit`, the only meaningful `decision` value is `"block"`
- Omitting `decision` means allow
- Other values are ignored
- `reason` is shown to the user but not injected into context
- `additionalContext` is injected as hidden context into the current turn

### Stop: prevent stopping and continue for one more turn

```json
{
  "decision": "block",
  "reason": "Run a final self-check before stopping",
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "additionalContext": "Verify there are no missing tests."
  }
}
```

Notes:

- For `Stop`, the only meaningful `decision` value is `"block"`
- Omitting `decision` means finish normally
- `reason` is injected as hidden context into the follow-up agent turn
- `additionalContext` is injected together with `reason` when `decision: "block"`; if no continuation happens, it is not kept for later user input
- `stop_hook_active` becomes `true` in follow-up `Stop` events triggered by a previous `Stop` hook, which helps avoid infinite loops
- The current implementation is based on Pi's `agent_end` + `sendMessage(..., { triggerTurn: true })`, so behavior is best-effort

### PreToolUse: deny or rewrite input

Available output fields:

- `permissionDecision`: `"allow" | "deny" | "ask"`
- `permissionDecisionReason`: the reason shown to the user/caller
- `updatedInput`: rewrites tool input before execution
- `additionalContext`: appends extra context for later processing

Example: deny execution

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Dangerous command blocked"
  }
}
```

Example: allow and rewrite input

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "My reason here",
    "updatedInput": {
      "field_to_modify": "new value"
    },
    "additionalContext": "Current environment: production. Proceed with caution."
  }
}
```

Notes:

- `permissionDecision: "deny"` blocks the current tool call and returns `permissionDecisionReason` to the agent; it does **not** directly stop the entire current processing flow
- `permissionDecision: "allow"` lets the tool run; if `updatedInput` is provided, the input is merged before execution
- `permissionDecision: "ask"` is kept for compatibility only; this extension does not open an additional permission UI
- `updatedInput` is merged into `event.input`, while unspecified fields keep their original values
- `additionalContext` does not block execution; it is only injected as hidden context and does not normally create an extra UI message
- To explicitly stop the current processing flow, use Claude Code's generic field `continue: false`

### PostToolUse: append context or patch tool results

Claude Code-style output example:

```json
{
  "decision": "block",
  "reason": "Explanation for decision",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "Additional information for Claude"
  }
}
```

Or:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "Command succeeded"
  }
}
```

Pi-specific direct result patching is also supported:

```json
{
  "systemMessage": "Hook patched tool result",
  "content": [
    {
      "type": "text",
      "text": "patched result"
    }
  ],
  "isError": false
}
```

Claude Code generic output fields are also supported:

```json
{
  "continue": false,
  "stopReason": "Stop current processing",
  "systemMessage": "Hook requested stop"
}
```

Notes:

- `hookSpecificOutput.hookEventName` is recognized following Claude Code behavior
- `decision: "block"` does not roll back an already executed tool; instead, `reason` is appended to model context as feedback
- `additionalContext` is injected into the current agent flow as hidden context, approximating Claude Code's “append context for Claude” behavior; it does not normally produce an extra UI message
- `systemMessage` is silent by default for tool-related events (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`) and does not normally generate an extra UI message
- `continue: false` stops current processing in tool events on a best-effort basis; this is different from `PreToolUse.permissionDecision: "deny"`, which only blocks the current tool and returns a reason to the agent
- For `PostToolUse` and `PostToolUseFailure`, stop-processing behavior does not add an extra local warning by default; the hook's own returned message/result takes precedence
- In addition to Claude Code-compatible fields, Pi-specific patching is still supported:
  - top-level `content`, `details`, `isError`
  - `hookSpecificOutput.updatedToolResult`
  - `updatedMCPToolOutput` (for MCP tool output replacement)
  - `hookSpecificOutput.updatedMCPToolOutput`

## Usage

### Local development

```bash
pi
```

Then run:

```text
/pi-hooks
/pi-hooks-reset
```

### As a Pi package

```bash
pi install git:github.com/killo3967/pi-hooks
```

The upstream npm package `@hsingjui/pi-hooks` still exists but is a stale snapshot without the
Windows shell fix; it is not the maintained version.

### Releasing

Versions are published from CI, not from a laptop. Once the package has a trusted publisher
configured on npmjs.com (GitHub Actions, repository `killo3967/pi-hooks`, workflow `publish.yml`,
with *Allow npm publish* enabled):

```bash
npm version patch   # or minor / major: bumps package.json and creates the tag
 git push --follow-tags
```

The tag triggers `.github/workflows/publish.yml`, which runs the checks and publishes with OIDC
short-lived credentials (plus provenance attestations). No npm token is stored in the repository.
Pushing a tag whose version is already on the registry is a no-op, so re-tags are safe.

### Tests and checks

```bash
pnpm install
pnpm run typecheck   # tsc --noEmit over src/ and test/
pnpm test            # node --test, no build step
```

Tests run against the TypeScript sources directly through Node's native type
stripping (Node 24+), so there is no build step, no test framework dependency
and no compiled output. Hook execution is exercised for real: a test writes a
throwaway script and runs it through the same shell resolution the extension
uses, which means the Windows `cmd.exe` fallback path is covered on Windows
runners and the POSIX `bash -c` path on Linux ones.

## Troubleshooting

Hooks are **fail-open**: when a hook cannot run, or returns something that is not a usable decision,
the tool call proceeds and a notification records what happened. That is deliberate — a broken hook
must not wedge your editor — but it means "my hook didn't block" is usually "my hook didn't run".

Check these in order:

1. **Did the command run at all?** A hook that cannot start (missing binary, unexpected shell)
   notifies `PreToolUse failed (exit N)` or `Hook error`. Test the command outside Pi first:

   ```bash
   echo '{"hook_event_name":"PreToolUse","tool_name":"bash","tool_input":{"command":"git add x"}}' | <your command>
   ```

   It has to print one JSON object and exit 0.

2. **Is the output valid JSON?** Exiting 0 while printing anything else counts as "no decision" and
   the tool runs; that case notifies `PreToolUse output (not JSON): …`.

3. **Does the hook apply at all?** `matcher` is a regex over the tool name and `if` filters per hook.
   If either does not match, the hook is skipped before anything runs.

4. **On Windows** the command runs through the shell resolved at startup: `shellPath` from
   `~/.pi/agent/settings.json`, then a known Git Bash/MSYS2 install, then `COMSPEC` (`cmd.exe`).
   A bare `bash` on PATH is deliberately not used, because it is usually the WSL launcher, which
   cannot see your Node.js installation or Windows paths. If your command needs bash features, point
   `shellPath` at Git Bash; otherwise write it to work under `cmd.exe` too.

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

## Notes

- Hook commands run in the current session `cwd`
- Global config and project config are merged by concatenating event arrays
- `PostToolUse` and `PostToolUseFailure` support Pi result patching
- Input/output aims to be Claude Code-compatible where possible; anything that cannot be mapped exactly is handled in a best-effort way using Pi's event model
