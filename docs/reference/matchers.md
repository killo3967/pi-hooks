# `matcher` Behavior

> Part of the [pi-hooks documentation](../README.md). The `matcher` regex and the per-hook `if` condition.


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

## SessionStart

Matches `source`:

- `startup`
- `resume`
- `compact`

## SessionEnd

Matches `reason`:

- `other`

## PreToolUse / PostToolUse / PostToolUseFailure

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
