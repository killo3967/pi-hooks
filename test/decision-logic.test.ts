import assert from "node:assert/strict";
import { test } from "node:test";
import { triggerUserPromptSubmitHooks } from "../src/hooks/prompt-hooks.ts";
import type { HookRunner } from "../src/hooks/shared.ts";
import { triggerStopHooks } from "../src/hooks/stop-hooks.ts";
import {
  triggerPostToolUseHooks,
  triggerPreToolUseHooks,
} from "../src/hooks/tool-hooks.ts";
import type {
  HookExecutionContext,
  HooksConfig,
  NotifyFn,
  SettingsFile,
} from "../src/types.ts";

// These tests describe decisions, not process execution: the injected runner
// returns canned streams, so nothing is spawned and each case costs ~1ms. The
// executor has its own tests against real processes.

function settingsFor(event: keyof HooksConfig, hookCount = 1): SettingsFile {
  return {
    hooks: {
      [event]: [
        {
          hooks: Array.from({ length: hookCount }, () => ({
            type: "command" as const,
            command: "unused",
          })),
        },
      ],
    },
  };
}

function runnerReturning(
  ...outputs: Array<{ stdout?: string; stderr?: string; exitCode?: number }>
): HookRunner & { calls: number } {
  let index = 0;
  const runner = (async () => {
    const out = outputs[Math.min(index, outputs.length - 1)] ?? {};
    index += 1;
    runner.calls = index;
    return {
      stdout: out.stdout ?? "",
      stderr: out.stderr ?? "",
      exitCode: out.exitCode ?? 0,
    };
  }) as HookRunner & { calls: number };
  runner.calls = 0;
  return runner;
}

function recorder(): { notify: NotifyFn; messages: Array<[string, string]> } {
  const messages: Array<[string, string]> = [];
  return { messages, notify: (message, type) => messages.push([message, type]) };
}

const preToolContext: HookExecutionContext = {
  sessionId: "session.jsonl",
  cwd: "/work",
  hookEventName: "PreToolUse",
  toolName: "bash",
  toolInput: { command: "ls" },
};

const denyJson = JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: "not allowed",
  },
});

test("PreToolUse denies through permissionDecision", async () => {
  const result = await triggerPreToolUseHooks(
    "bash",
    preToolContext,
    settingsFor("PreToolUse"),
    undefined,
    runnerReturning({ stdout: denyJson }),
  );

  assert.equal(result.blocked, true);
  assert.equal(result.reason, "not allowed");
});

test("PreToolUse blocks on exit code 2 and takes stderr as the reason", async () => {
  const result = await triggerPreToolUseHooks(
    "bash",
    preToolContext,
    settingsFor("PreToolUse"),
    undefined,
    runnerReturning({ stderr: "denied", exitCode: 2 }),
  );

  assert.equal(result.blocked, true);
  assert.equal(result.reason, "denied");
});

test("PreToolUse applies updatedInput without blocking", async () => {
  const result = await triggerPreToolUseHooks(
    "bash",
    preToolContext,
    settingsFor("PreToolUse"),
    undefined,
    runnerReturning({
      stdout: JSON.stringify({
        hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { command: "ls -la" } },
      }),
    }),
  );

  assert.equal(result.blocked, false);
  assert.deepEqual(result.updatedInput, { command: "ls -la" });
});

test("a later hook does not run once a hook decided to block", async () => {
  const runner = runnerReturning({ stderr: "denied", exitCode: 2 }, { stdout: denyJson });

  await triggerPreToolUseHooks(
    "bash",
    preToolContext,
    settingsFor("PreToolUse", 2),
    undefined,
    runner,
  );

  assert.equal(runner.calls, 1);
});

test("PostToolUse patches the result with hook content", async () => {
  const result = await triggerPostToolUseHooks(
    "bash",
    { ...preToolContext, hookEventName: "PostToolUse" },
    settingsFor("PostToolUse"),
    undefined,
    runnerReturning({
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          updatedToolResult: { content: [{ type: "text", text: "patched" }], isError: false },
        },
      }),
    }),
  );

  assert.deepEqual(result.content, [{ type: "text", text: "patched" }]);
  assert.equal(result.isError, false);
});

test("UserPromptSubmit blocks the prompt and keeps the reason", async () => {
  const result = await triggerUserPromptSubmitHooks(
    { ...preToolContext, hookEventName: "UserPromptSubmit", prompt: "hola" },
    settingsFor("UserPromptSubmit"),
    undefined,
    runnerReturning({ stdout: JSON.stringify({ decision: "block", reason: "not now" }) }),
  );

  assert.equal(result.blocked, true);
  assert.equal(result.reason, "not now");
});

test("Stop asks for another turn and keeps the reason", async () => {
  const result = await triggerStopHooks(
    { ...preToolContext, hookEventName: "Stop" },
    settingsFor("Stop"),
    undefined,
    runnerReturning({ stdout: JSON.stringify({ decision: "block", reason: "keep going" }) }),
  );

  assert.equal(result.blocked, true);
  assert.equal(result.reason, "keep going");
});

test("an unknown decision is reported and does not block", async () => {
  const { notify, messages } = recorder();

  const result = await triggerStopHooks(
    { ...preToolContext, hookEventName: "Stop" },
    settingsFor("Stop"),
    notify,
    runnerReturning({ stdout: JSON.stringify({ decision: "maybe" }) }),
  );

  assert.equal(result.blocked, false);
  assert.equal(messages.length, 1);
  assert.match(messages[0]?.[0] ?? "", /maybe/);
});
