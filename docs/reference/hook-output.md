# Hook Output

> Part of the [pi-hooks documentation](../README.md). The JSON each hook may print, per event.


## UserPromptSubmit: block the prompt or inject extra context

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

## Stop: prevent stopping and continue for one more turn

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

## PreToolUse: deny or rewrite input

Available output fields:

- `permissionDecision`: `"allow" | "deny"`
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
- `permissionDecision: "ask"` is **not supported**. Pi has no per-call approval model: it "does not ask for approval before every tool call", on purpose, and security comes from limiting what the process can reach (see Pi's `docs/security.md`). Claude Code's third state therefore has no equivalent here: a hook that returns it is ignored, and the tool call proceeds as if no decision had been made. Use `deny` when you need a human to intervene, or write a Pi extension with `ctx.ui.confirm` if you want an actual prompt.
- `updatedInput` is merged into `event.input`, while unspecified fields keep their original values
- `additionalContext` does not block execution; it is only injected as hidden context and does not normally create an extra UI message
- To explicitly stop the current processing flow, use Claude Code's generic field `continue: false`

## PostToolUse: append context or patch tool results

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
