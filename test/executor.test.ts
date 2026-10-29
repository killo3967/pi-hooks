import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHookInput, executeHook } from "../src/executor.ts";
import type { HookExecutionContext } from "../src/types.ts";
import { createHookScript } from "./support/hook-script.ts";

const base: HookExecutionContext = {
  sessionId: "session.jsonl",
  cwd: "/work",
  hookEventName: "SessionStart",
  transcriptPath: "/work/session.jsonl",
};

const baseInput = {
  session_id: "session.jsonl",
  cwd: "/work",
  transcript_path: "/work/session.jsonl",
};

test("buildHookInput always carries the base payload", () => {
  const input = buildHookInput({
    ...base,
    hookEventName: "SessionStart",
    source: "startup",
    model: "claude",
  });

  assert.deepEqual(input, {
    ...baseInput,
    hook_event_name: "SessionStart",
    source: "startup",
    model: "claude",
  });
});

test("buildHookInput describes SessionEnd", () => {
  const input = buildHookInput({
    ...base,
    hookEventName: "SessionEnd",
    reason: "other",
    model: "claude",
  });

  assert.deepEqual(input, {
    ...baseInput,
    hook_event_name: "SessionEnd",
    reason: "other",
    model: "claude",
  });
});

test("buildHookInput describes PreCompact and defaults custom instructions", () => {
  const input = buildHookInput({
    ...base,
    hookEventName: "PreCompact",
    trigger: "auto",
  });

  assert.deepEqual(input, {
    ...baseInput,
    hook_event_name: "PreCompact",
    trigger: "auto",
    custom_instructions: "",
  });
});

test("buildHookInput describes PostCompact", () => {
  const input = buildHookInput({
    ...base,
    hookEventName: "PostCompact",
    trigger: "manual",
    compactSummary: "summary",
  });

  assert.deepEqual(input, {
    ...baseInput,
    hook_event_name: "PostCompact",
    trigger: "manual",
    compact_summary: "summary",
  });
});

test("buildHookInput describes UserPromptSubmit", () => {
  const input = buildHookInput({
    ...base,
    hookEventName: "UserPromptSubmit",
    prompt: "hello",
  });

  assert.deepEqual(input, {
    ...baseInput,
    hook_event_name: "UserPromptSubmit",
    prompt: "hello",
  });
});

test("buildHookInput describes Stop with defaults", () => {
  const input = buildHookInput({ ...base, hookEventName: "Stop" });

  assert.deepEqual(input, {
    ...baseInput,
    hook_event_name: "Stop",
    stop_hook_active: false,
    last_assistant_message: "",
  });
});

test("buildHookInput describes PreToolUse without a response", () => {
  const input = buildHookInput({
    ...base,
    hookEventName: "PreToolUse",
    toolName: "Bash",
    toolInput: { command: "ls" },
    toolUseId: "call-1",
  });

  assert.deepEqual(input, {
    ...baseInput,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "ls" },
    tool_use_id: "call-1",
  });
});

test("buildHookInput adds the response on PostToolUse", () => {
  const input = buildHookInput({
    ...base,
    hookEventName: "PostToolUse",
    toolName: "Bash",
    toolInput: { command: "ls" },
    toolUseId: "call-1",
    toolResponse: { output: "file.txt", is_error: false },
  });

  assert.deepEqual(input, {
    ...baseInput,
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command: "ls" },
    tool_use_id: "call-1",
    tool_response: { output: "file.txt", is_error: false },
  });
});

test("buildHookInput adds the error on PostToolUseFailure", () => {
  const input = buildHookInput({
    ...base,
    hookEventName: "PostToolUseFailure",
    toolName: "Bash",
    toolInput: { command: "nope" },
    toolUseId: "call-1",
    error: "command not found",
  });

  assert.deepEqual(input, {
    ...baseInput,
    hook_event_name: "PostToolUseFailure",
    tool_name: "Bash",
    tool_input: { command: "nope" },
    tool_use_id: "call-1",
    error: "command not found",
  });
});

test("buildHookInput forwards an explicit is_interrupt", () => {
  const input = buildHookInput({
    ...base,
    hookEventName: "PostToolUseFailure",
    toolName: "Bash",
    toolInput: {},
    toolUseId: "call-1",
    error: "aborted",
    isInterrupt: false,
  }) as Record<string, unknown>;

  assert.equal(input.is_interrupt, false);
});

test("executeHook writes the input JSON to stdin and returns stdout", async () => {
  const script = createHookScript(`  out(payload);`);
  try {
    const result = await executeHook(
      { type: "command", command: script.command },
      { hook_event_name: "Stop", nested: { a: 1 } },
      script.dir,
      15000,
    );

    assert.equal(result.exitCode, 0);
    assert.deepEqual(JSON.parse(result.stdout), {
      hook_event_name: "Stop",
      nested: { a: 1 },
    });
  } finally {
    script.cleanup();
  }
});

test("executeHook reports the exit code and stderr of a failing hook", async () => {
  const script = createHookScript(`  fail(3, "boom");`);
  try {
    const result = await executeHook(
      { type: "command", command: script.command },
      {},
      script.dir,
      15000,
    );

    assert.equal(result.exitCode, 3);
    assert.equal(result.stderr, "boom");
  } finally {
    script.cleanup();
  }
});

test("executeHook kills a hook that exceeds its timeout", async () => {
  const script = createHookScript(`
  setTimeout(() => out({ done: true }), 5000);`);
  try {
    const started = Date.now();
    const result = await executeHook(
      { type: "command", command: script.command },
      {},
      script.dir,
      300,
    );

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Hook timed out/);
    assert.ok(Date.now() - started < 4000, "the hook should be killed early");
  } finally {
    script.cleanup();
  }
});
