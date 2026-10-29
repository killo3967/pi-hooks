import assert from "node:assert/strict";
import { test } from "node:test";
import {
  triggerPostToolUseFailureHooks,
  triggerPostToolUseHooks,
  triggerPreToolUseHooks,
} from "../src/hooks/tool-hooks.ts";
import type { HookExecutionContext } from "../src/types.ts";
import { createHookScript } from "./support/hook-script.ts";
import { recorder, settingsWith } from "./support/settings.ts";

function toolContext(
  toolName: string,
  toolInput: Record<string, unknown>,
  overrides: Partial<HookExecutionContext> = {},
): HookExecutionContext {
  return {
    sessionId: "session.jsonl",
    cwd: process.cwd(),
    hookEventName: "PreToolUse",
    toolName,
    toolInput,
    toolUseId: "call-1",
    ...overrides,
  };
}

const bash = toolContext("Bash", { command: "ls" });

test("PreToolUse denies the call through hookSpecificOutput", async () => {
  const script = createHookScript(`
  out({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "no bash" } });`);
  try {
    const settings = settingsWith("PreToolUse", { type: "command", command: script.command }, "Bash");
    const { notify, messages } = recorder();

    const result = await triggerPreToolUseHooks("Bash", bash, settings, notify);

    assert.equal(result.blocked, true);
    assert.equal(result.reason, "no bash");
    assert.deepEqual(
      messages.map(([, type]) => type),
      ["warning"],
    );
    assert.equal(messages[0]?.[0], "PreToolUse denied by hook: no bash");
  } finally {
    script.cleanup();
  }
});

test("PreToolUse denies the call through a top-level permissionDecision", async () => {
  const script = createHookScript(`
  out({ permissionDecision: "deny", permissionDecisionReason: "nope" });`);
  try {
    const settings = settingsWith("PreToolUse", { type: "command", command: script.command });

    const result = await triggerPreToolUseHooks("Bash", bash, settings);

    assert.equal(result.blocked, true);
    assert.equal(result.reason, "nope");
  } finally {
    script.cleanup();
  }
});

test("PreToolUse defaults the deny reason when the hook omits it", async () => {
  const script = createHookScript(`
  out({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } });`);
  try {
    const result = await triggerPreToolUseHooks(
      "Bash",
      bash,
      settingsWith("PreToolUse", { type: "command", command: script.command }),
    );

    assert.equal(result.blocked, true);
    assert.equal(result.reason, "Blocked by a hook");
  } finally {
    script.cleanup();
  }
});

test("PreToolUse blocks on exit code 2 and uses stderr as the reason", async () => {
  const script = createHookScript(`  fail(2, "denied by script");`);
  try {
    const { notify, messages } = recorder();

    const result = await triggerPreToolUseHooks(
      "Bash",
      bash,
      settingsWith("PreToolUse", { type: "command", command: script.command }),
      notify,
    );

    assert.equal(result.blocked, true);
    assert.equal(result.reason, "denied by script");
    assert.equal(messages[0]?.[0], "PreToolUse blocked (exit 2): denied by script");
  } finally {
    script.cleanup();
  }
});

test("PreToolUse applies updatedInput without blocking", async () => {
  const script = createHookScript(`
  out({ hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { command: "ls -la" } } });`);
  try {
    const result = await triggerPreToolUseHooks(
      "Bash",
      bash,
      settingsWith("PreToolUse", { type: "command", command: script.command }),
    );

    assert.equal(result.blocked, false);
    assert.deepEqual(result.updatedInput, { command: "ls -la" });
  } finally {
    script.cleanup();
  }
});

test("PreToolUse honours the per-hook if condition", async () => {
  const script = createHookScript(`
  out({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } });`);
  try {
    const settings = settingsWith(
      "PreToolUse",
      { type: "command", command: script.command, if: "Bash(rm *)" },
      "Bash",
    );

    const skipped = await triggerPreToolUseHooks("Bash", bash, settings);
    assert.equal(skipped.blocked, false);

    const matched = await triggerPreToolUseHooks(
      "Bash",
      toolContext("Bash", { command: "rm -rf /tmp/x" }),
      settings,
    );
    assert.equal(matched.blocked, true);
  } finally {
    script.cleanup();
  }
});

test("PreToolUse skips hooks whose matcher does not match the tool", async () => {
  const script = createHookScript(`
  out({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } });`);
  try {
    const result = await triggerPreToolUseHooks(
      "Bash",
      bash,
      settingsWith("PreToolUse", { type: "command", command: script.command }, "Read"),
    );

    assert.equal(result.blocked, false);
  } finally {
    script.cleanup();
  }
});

test("PreToolUse reports non-JSON stdout without blocking", async () => {
  const script = createHookScript(`  raw("just text");`);
  try {
    const { notify, messages } = recorder();

    const result = await triggerPreToolUseHooks(
      "Bash",
      bash,
      settingsWith("PreToolUse", { type: "command", command: script.command }),
      notify,
    );

    assert.equal(result.blocked, false);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.[1], "info");
  } finally {
    script.cleanup();
  }
});

test("PreToolUse reports a failing hook as an error", async () => {
  const script = createHookScript(`  fail(3, "boom");`);
  try {
    const { notify, messages } = recorder();

    const result = await triggerPreToolUseHooks(
      "Bash",
      bash,
      settingsWith("PreToolUse", { type: "command", command: script.command }),
      notify,
    );

    assert.equal(result.blocked, false);
    assert.deepEqual(
      messages.map(([, type]) => type),
      ["error"],
    );
    assert.match(messages[0]?.[0] ?? "", /exit 3/);
  } finally {
    script.cleanup();
  }
});

test("PreToolUse times a hook out using its own timeout", async () => {
  const script = createHookScript(`
  setTimeout(() => out({}), 5000);`);
  try {
    const { notify, messages } = recorder();

    const result = await triggerPreToolUseHooks(
      "Bash",
      bash,
      settingsWith("PreToolUse", { type: "command", command: script.command, timeout: 0.3 }),
      notify,
    );

    assert.equal(result.blocked, false);
    assert.match(messages[0]?.[0] ?? "", /timed out/);
  } finally {
    script.cleanup();
  }
});

test("PostToolUse patches the tool result content", async () => {
  const script = createHookScript(`
  out({ hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolResult: { content: [{ type: "text", text: "patched" }], isError: false } } });`);
  try {
    const result = await triggerPostToolUseHooks(
      "Bash",
      toolContext("Bash", { command: "ls" }, { hookEventName: "PostToolUse" }),
      settingsWith("PostToolUse", { type: "command", command: script.command }),
    );

    assert.deepEqual(result.content, [{ type: "text", text: "patched" }]);
    assert.equal(result.isError, false);
  } finally {
    script.cleanup();
  }
});

test("PostToolUse collects additionalContext", async () => {
  const script = createHookScript(`
  out({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "remember this" } });`);
  try {
    const result = await triggerPostToolUseHooks(
      "Bash",
      toolContext("Bash", { command: "ls" }, { hookEventName: "PostToolUse" }),
      settingsWith("PostToolUse", { type: "command", command: script.command }),
    );

    assert.equal(result.additionalContext, "remember this");
  } finally {
    script.cleanup();
  }
});

test("PostToolUse treats exit code 2 as feedback, not a patch", async () => {
  const script = createHookScript(`  fail(2, "please format");`);
  try {
    const { notify, messages } = recorder();

    const result = await triggerPostToolUseHooks(
      "Bash",
      toolContext("Bash", { command: "ls" }, { hookEventName: "PostToolUse" }),
      settingsWith("PostToolUse", { type: "command", command: script.command }),
      notify,
    );

    assert.equal(result.content, undefined);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.[1], "warning");
    assert.match(messages[0]?.[0] ?? "", /please format/);
  } finally {
    script.cleanup();
  }
});

test("PostToolUseFailure patches the failed result", async () => {
  const script = createHookScript(`
  out({ isError: true, content: [{ type: "text", text: "annotated" }] });`);
  try {
    const result = await triggerPostToolUseFailureHooks(
      "Bash",
      toolContext("Bash", { command: "nope" }, {
        hookEventName: "PostToolUseFailure",
        error: "command not found",
      }),
      settingsWith("PostToolUseFailure", { type: "command", command: script.command }),
    );

    assert.deepEqual(result.content, [{ type: "text", text: "annotated" }]);
    assert.equal(result.isError, true);
  } finally {
    script.cleanup();
  }
});

test("tool hooks are inert without settings", async () => {
  assert.equal((await triggerPreToolUseHooks("Bash", bash, undefined)).blocked, false);
  assert.deepEqual(await triggerPostToolUseHooks("Bash", bash, undefined), {});
  assert.deepEqual(await triggerPostToolUseFailureHooks("Bash", bash, undefined), {});
});

test("PreToolUse blocks with the configuration reported in issue #1", async () => {
  // Issue #1 reported that this shape never blocked a `git add` call: a hook
  // printing its deny JSON, a lowercase "bash" matcher and an "if" condition on
  // the command. The output starts with a newline, which the parser trims.
  const script = createHookScript(`
  raw(String.fromCharCode(10));
  out({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "git add is disabled - use git add -p" } });`);
  try {
    const settings = settingsWith(
      "PreToolUse",
      { type: "command", command: script.command, if: "Bash(git add*)" },
      "bash",
    );

    const result = await triggerPreToolUseHooks(
      "bash",
      toolContext("bash", { command: "git add 111.txt" }),
      settings,
    );

    assert.equal(result.blocked, true);
    assert.equal(result.reason, "git add is disabled - use git add -p");
  } finally {
    script.cleanup();
  }
});
