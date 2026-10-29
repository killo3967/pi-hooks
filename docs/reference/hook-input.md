# Hook Input

> Part of the [pi-hooks documentation](../README.md). The JSON payload each hook receives on stdin.


Input fields are designed to be as close as possible to Claude Code hooks:

- Common fields: `session_id`, `transcript_path`, `cwd`, `hook_event_name`
- Event-specific fields such as `source`, `reason`, `tool_name`, `tool_input`, `tool_response`
- **Pi-specific extra fields may also be included**, but they should not break Claude Code-style scripts

## SessionStart

```json
{
  "session_id": "session-file-path",
  "transcript_path": "/path/to/session.jsonl",
  "cwd": "/current/working/directory",
  "hook_event_name": "SessionStart",
  "source": "startup"
}
```

## SessionEnd

```json
{
  "session_id": "session-file-path",
  "transcript_path": "/path/to/session.jsonl",
  "cwd": "/current/working/directory",
  "hook_event_name": "SessionEnd",
  "reason": "other"
}
```

## UserPromptSubmit

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

## Stop

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

## PreToolUse

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

## PostToolUse

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
