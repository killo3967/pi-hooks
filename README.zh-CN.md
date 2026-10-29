# pi-hooks

[English](./README.md) | 简体中文

将 Claude Code 的 command hooks 配置格式适配到 Pi 的扩展事件系统。

> **维护分支。** 本仓库是 `pi-hooks` 的维护版本。上游（`hsingjui/pi-hooks`）自 **2026-05-08** 起未再修改，npm 上的 `@hsingjui/pi-hooks`（0.0.2）也不包含 Windows 下 shell 解析的修复（[#3](https://github.com/hsingjui/pi-hooks/issues/3)）。请从本仓库安装：
>
> ```bash
> pi install git:github.com/killo3967/pi-hooks
> ```
>
> `main` 包含 [@KedraVt](https://github.com/KedraVt) 在 [PR #6](https://github.com/hsingjui/pi-hooks/pull/6) 中提交的跨平台 shell 解析：settings `shellPath` → 已知的 Git Bash/MSYS2 路径 → `COMSPEC`/`cmd.exe`。它取代了 [PR #4](https://github.com/hsingjui/pi-hooks/pull/4)（两者修改 `src/executor.ts` 的同一段代码，不应同时合并）。
>
> 上游的 issue 和 PR 仍作为待办来源阅读，但修复在本仓库进行。

这个包把 Claude Code 的 hooks 配置习惯映射到 Pi 的扩展事件系统上，方便你以较少改动复用原有的 command hook 工作流。

## Quick Setup

1. 安装包：

```bash
pi install git:github.com/killo3967/pi-hooks
```

2. 在 `.pi/settings.json`（或 `~/.pi/agent/settings.json`）里添加 hooks：

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

3. 执行 `/reload`，然后发一条消息测试。

## 当前支持范围

- 仅支持 `type: "command"`
- 支持 hook handler 的 `if` 字段（仅工具事件生效）
- 支持事件：
  - `SessionStart`
  - `SessionEnd`
  - `PreCompact`
  - `PostCompact`
  - `PreToolUse`
  - `PostToolUse`
  - `PostToolUseFailure`
  - `UserPromptSubmit`
  - `Stop`
- 不支持：`http`、`prompt`、`agent`

## 事件映射关系

- `SessionStart.startup` → `session_start(reason="startup")`
- `SessionStart.startup` → `session_start(reason="new")`
- `SessionStart.resume` → `session_start(reason="resume")`
- `SessionStart.compact` → `session_compact`
- `SessionEnd.other` → `session_shutdown`
- `Stop` → `agent_end`（best-effort 对齐 Claude Code 的“响应完成后触发”行为）

## 配置格式

在 `~/.pi/agent/settings.json` 或 `.pi/settings.json` 中配置：

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

## `matcher` 配置

为尽量对齐 Claude Code，`matcher` 是**单个正则字符串**。

- 省略 `matcher` 表示匹配全部
- `""` 表示匹配全部
- `"*"` 表示匹配全部
- 其他值按正则表达式处理
- 正则无效时，退化为普通字符串精确匹配

示例：

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

各事件的 matcher 匹配字段：

### SessionStart

匹配 `source`：

- `startup`
- `resume`
- `compact`

### SessionEnd

匹配 `reason`：

- `other`

### PreToolUse / PostToolUse / PostToolUseFailure

匹配 `tool_name`。

注意：这里直接使用 Pi 里的原始工具名，因此通常是小写，例如：

- `bash`
- `read`
- `write`
- `edit`
- `grep`
- `find`
- `ls`
- `mcp__.*`

说明：

- `SessionEnd` 由 `session_shutdown` 触发
- 当 `matcher` 省略时，`SessionEnd` 默认按 `other` 处理
- `UserPromptSubmit` 和 `Stop` 不支持 `matcher`，即使配置了也会被忽略

## `if` 条件

对齐 Claude Code 的思路，`if` 配在单个 hook handler 上，只在工具事件中生效：

- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`

其他事件如果配置了 `if`，该 hook 不会运行。

当前支持的形式：

- `Bash(git *)`
- `bash(git *)`
- `Edit(*.ts)`
- `Write(*.md)`
- `mcp__memory__create_entities(*)`

规则：

- `if` 语法为 `ToolName(pattern)`
- `ToolName` 按工具名比较，大小写不敏感
- `pattern` 使用简单通配符匹配，`*` 表示任意字符串
- `bash` 主要匹配 `tool_input.command`
- `read` / `write` / `edit` 主要匹配 `tool_input.path`（或 `file_path`）
- 其他工具优先匹配常见主字段，匹配不到时退化为 `tool_input` 的 JSON 字符串

示例：只拦截 `git push`

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

## Hook 输入

默认输入字段尽量对齐 Claude Code hooks：

- 通用字段：`session_id`、`transcript_path`、`cwd`、`hook_event_name`
- 事件字段：如 `source`、`reason`、`tool_name`、`tool_input`、`tool_response`
- **允许多出 Pi 特有字段**，但不会破坏 Claude Code 风格脚本的读取方式

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

说明：

- `UserPromptSubmit` 不支持 `matcher`，即使配置也会被忽略
- 会在用户提交输入后、agent loop 开始前触发

### Stop

对应 Pi 的 `agent_end` 事件。

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

说明：

- `Stop` 在本轮 agent 处理完成后触发
- `Stop` 不支持 `matcher`，即使配置也会被忽略
- `stop_hook_active` 用于标识当前继续执行是否由上一次 `Stop` hook 触发
- `last_assistant_message` 会尽量提取最后一条 assistant 文本内容；若没有文本则为空字符串
- `decision: "block"` 时，会以隐藏上下文 + 追加一轮 agent 的方式 best-effort 模拟 Claude Code 的“阻止停止并继续”语义

### PreToolUse

对应 Pi 的 `tool_call` 事件。

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

说明：

- `PreToolUse` 在工具真正执行前触发
- 映射到 Pi 的 `tool_call`，而不是 `tool_execution_start`
- 支持 `matcher`，并按 `tool_name` 做正则匹配
- 不包含 `permission_mode`
- `tool_name` 直接使用 Pi 事件里的原始值，不做大小写转换
- `tool_input` 对应 `tool_call` 的 `event.input`
- `tool_use_id` 对应 `tool_call` 的 `event.toolCallId`

### PostToolUse

对应 Pi 的 `tool_result` 事件，仅在工具成功完成时触发。

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

说明：

- `PostToolUse` 在工具成功执行后触发
- 映射到 Pi 的 `tool_result`
- 不包含 `permission_mode`
- `tool_name` 直接使用 Pi 事件里的原始值，不做大小写转换
- `tool_input` 对应 `tool_result` 的 `event.input`
- `tool_response` 对应当前工具结果的 Claude Code 风格兼容对象
- `tool_use_id` 对应 `tool_result` 的 `event.toolCallId`
- 失败结果不会进入 `PostToolUse`，而是进入 `PostToolUseFailure`

## Hook 输出

### UserPromptSubmit：阻止提示词或附加上下文

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

说明：

- `UserPromptSubmit` 里只有 `"block"` 是有效的 `decision` 值
- 省略 `decision` 表示允许继续
- 其他值会被忽略
- `reason` 只展示给用户，不会加入上下文
- `additionalContext` 会作为隐藏上下文注入当前轮

### Stop：阻止停止并继续一轮

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

说明：

- `Stop` 里只有 `"block"` 是有效的 `decision` 值
- 省略 `decision` 表示正常结束
- `reason` 会作为隐藏上下文注入到后续 agent turn
- `additionalContext` 会在 `decision: "block"` 时与 `reason` 一起注入下一轮；如果没有继续执行，就不会保留到后续用户输入
- 由 `Stop` hook 续跑出的后续 `Stop` 事件中，`stop_hook_active` 会变为 `true`，可用于避免无限循环
- 当前实现基于 Pi 的 `agent_end` + `sendMessage(..., { triggerTurn: true })`，属于 best-effort 对齐

### PreToolUse：阻止或改写参数

可用输出字段：

- `permissionDecision`: `"allow" | "deny" | "ask"`
- `permissionDecisionReason`: 展示给用户/调用方的原因
- `updatedInput`: 用于改写工具入参
- `additionalContext`: 追加给后续处理的上下文

示例：阻止执行

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Dangerous command blocked"
  }
}
```

示例：允许并改写参数

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

说明：

- `permissionDecision: "deny"` 会阻止当前工具调用，并把 `permissionDecisionReason` 作为阻止原因返回给 agent；**不会直接停止整个当前处理流程**
- `permissionDecision: "allow"` 会放行；若带 `updatedInput`，则在执行前改写参数
- `permissionDecision: "ask"` 当前仅保留兼容字段语义，本扩展里不会额外弹出权限确认 UI
- `updatedInput` 会合并到当前 `event.input` 上，未提供的字段保持原值
- `additionalContext` 不会阻止执行，只作为附加上下文使用；会注入隐藏上下文，但默认不会额外显示一条 UI 提示
- 若需要显式停止整个当前处理流程，请使用 Claude Code 通用字段 `continue: false`

### PostToolUse：附加上下文或 patch 结果

Claude Code 风格输出示例：

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

或：

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "Command succeeded"
  }
}
```

Pi 扩展层也支持直接 patch 工具结果：

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

也支持 Claude Code 通用输出字段：

```json
{
  "continue": false,
  "stopReason": "Stop current processing",
  "systemMessage": "Hook requested stop"
}
```

说明：

- `hookSpecificOutput.hookEventName` 会按 Claude Code 规则识别
- `decision: "block"` 不会回滚已执行的工具；会把 `reason` 当作反馈附加给模型上下文
- `additionalContext` 会通过隐藏上下文注入当前 agent 流程，尽量贴近 Claude Code 的“给 Claude 追加上下文”语义；默认不会额外显示一条 UI 提示
- `systemMessage` 在工具相关事件（`PreToolUse` / `PostToolUse` / `PostToolUseFailure`）默认静默，不额外显示 UI 提示
- `continue: false` 会在工具事件里以 best-effort 方式停止当前处理；这和 `PreToolUse.permissionDecision: "deny"` 不同，后者只阻止当前工具并把原因反馈给 agent
- `PostToolUse` / `PostToolUseFailure` 的 stop-processing 默认不会再额外补一条本地 warning，优先以 hook 自身返回的 message / result 为准
- 除 Claude Code 兼容字段外，仍支持 Pi 特有 patch：
  - 顶层 `content` / `details` / `isError`
  - `hookSpecificOutput.updatedToolResult`
  - `updatedMCPToolOutput`（用于 MCP 工具输出替换）
  - `hookSpecificOutput.updatedMCPToolOutput`

## 使用方法

### 本地开发

```bash
pi
```

然后执行：

```text
/pi-hooks
/pi-hooks-reset
```

### 作为 Pi 包使用

```bash
pi install git:github.com/killo3967/pi-hooks
```

上游的 npm 包 `@hsingjui/pi-hooks` 仍然存在，但已过时且不含 Windows shell 修复，不是维护版本。

## 项目结构

源码位于 `src/`：

- `src/pi-hooks.ts` - 扩展入口
- `src/config.ts` - 配置加载与合并
- `src/executor.ts` - command hook 执行器
- `src/hooks/shared.ts` - hook 共享解析与执行辅助
- `src/hooks/session-hooks.ts` - `SessionStart` / `SessionEnd`
- `src/hooks/compact-hooks.ts` - `PreCompact` / `PostCompact`
- `src/hooks/prompt-hooks.ts` - `UserPromptSubmit`
- `src/hooks/tool-hooks.ts` - `PreToolUse` / `PostToolUse` / `PostToolUseFailure`
- `src/hooks/stop-hooks.ts` - `Stop`
- `src/types.ts` - 类型定义

## 说明

- hook 命令会在当前会话 `cwd` 中执行
- 全局配置与项目配置会按事件数组拼接合并
- `PostToolUse` / `PostToolUseFailure` 现在支持返回 Pi 的结果 patch
- 输入 / 输出尽量兼容 Claude Code hooks；无法原样映射的部分按 Pi 事件能力 best-effort 处理
