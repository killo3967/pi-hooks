import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  buildHookInput,
  configureShell,
  executeHook,
  resolveShell,
} from "../src/executor.ts";
import type { HookExecutionContext } from "../src/types.ts";
import { createHookScript, createRawScript } from "./support/hook-script.ts";

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

test("executeHook survives a hook that exits without reading a large payload", async () => {
  // A real hook often exits before reading stdin (`exit 2`, a one-line block),
  // while the payload can be large: tool_input carries file contents and
  // tool_response carries command output. Writing into that closed pipe used to
  // raise an uncaught EOF error and take the process down.
  const script = createRawScript("process.exit(0);");
  try {
    const payload = { tool_name: "read", tool_response: { content: "x".repeat(256 * 1024) } };

    const result = await executeHook(
      { type: "command", command: script.command },
      payload,
      script.dir,
      15000,
    );

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "");
  } finally {
    script.cleanup();
  }
});

test("executeHook keeps the decision of a hook that bails out before reading stdin", async () => {
  const script = createRawScript('process.stderr.write("denied before reading");\nprocess.exit(2);');
  try {
    const result = await executeHook(
      { type: "command", command: script.command },
      { tool_input: { content: "x".repeat(256 * 1024) } },
      script.dir,
      15000,
    );

    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr, "denied before reading");
  } finally {
    script.cleanup();
  }
});

test("executeHook kills the whole hook process tree on timeout", async () => {
  // The hook runs through a shell, so the spawned child is the shell and the
  // command is its child. Killing only the shell leaves the command running and
  // holding the pipes. This grandchild writes a marker 1.2s after the 300ms
  // timeout has already fired.
  const script = createRawScript(`
const { spawn } = require("node:child_process");
spawn(process.execPath, ["-e", "setTimeout(() => require('node:fs').writeFileSync(require('node:path').join(process.cwd(), 'marker.txt'), 'alive'), 1200)"], { stdio: "ignore" });
setTimeout(() => {}, 4000);`);
  try {
    const result = await executeHook(
      { type: "command", command: script.command },
      {},
      script.dir,
      300,
    );

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Hook timed out after 300 ms/);

    await new Promise((resolve) => setTimeout(resolve, 2500));

    assert.equal(
      existsSync(path.join(script.dir, "marker.txt")),
      false,
      "a process started by the hook survived the timeout",
    );
  } finally {
    try {
      script.cleanup();
    } catch {
      // Only happens while the bug is present: the leaked process still has the
      // script directory as its cwd. The assertion above already reported it.
    }
  }
});

test("executeHook caps the output it captures from a hook", async () => {
  // A hook can print without limit. Capturing it all means the bytes live in the
  // Pi process until the hook ends, and then get parsed or shown; a runaway hook
  // should not be able to grow the host's memory without bound.
  const script = createRawScript(`
const chunk = "x".repeat(65536);
for (let i = 0; i < 40; i++) process.stdout.write(chunk);
for (let i = 0; i < 40; i++) process.stderr.write(chunk);`);
  try {
    const result = await executeHook(
      { type: "command", command: script.command },
      {},
      script.dir,
      30000,
    );

    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.length < 1_100_000, `stdout was ${result.stdout.length}`);
    assert.ok(result.stderr.length < 1_100_000, `stderr was ${result.stderr.length}`);
    assert.match(result.stdout, /truncated/);
    assert.match(result.stderr, /truncated/);
  } finally {
    script.cleanup();
  }
});

test("configureShell decides the shell the next hooks run under", () => {
  // The session settings are the only reader of shellPath; the executor just
  // consumes the decision instead of reading settings a second time.
  try {
    configureShell(process.execPath);
    assert.equal(resolveShell().shell, process.execPath);
  } finally {
    configureShell(undefined);
  }
  assert.notEqual(resolveShell().shell, process.execPath);
});
