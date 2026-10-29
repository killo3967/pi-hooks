import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appendAdditionalContext,
  extractCommonOutput,
  extractToolResultPatch,
  getHookSpecificOutput,
  hookIfMatches,
  parseJsonOutput,
} from "../src/hooks/shared.ts";
import type { HookExecutionContext } from "../src/types.ts";

function toolContext(
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
  overrides: Partial<HookExecutionContext> = {},
): HookExecutionContext {
  return {
    sessionId: "session.jsonl",
    cwd: "/work",
    hookEventName: "PreToolUse",
    toolName,
    toolInput,
    ...overrides,
  };
}

const bash = toolContext("Bash", { command: "git status" });

test("hookIfMatches treats a missing or empty condition as always true", () => {
  assert.equal(hookIfMatches(bash, undefined), true);
  assert.equal(hookIfMatches(bash, ""), true);
});

test("hookIfMatches compares the tool name case-insensitively", () => {
  assert.equal(hookIfMatches(bash, "Bash"), true);
  assert.equal(hookIfMatches(bash, "bash"), true);
  assert.equal(hookIfMatches(bash, " Read "), false);
  assert.equal(hookIfMatches(bash, "Bash|Read"), false);
});

test("hookIfMatches globs the tool input", () => {
  assert.equal(hookIfMatches(bash, "Bash(git*)"), true);
  assert.equal(hookIfMatches(bash, "Bash(*status)"), true);
  assert.equal(hookIfMatches(bash, "Bash(GIT*)"), true);
  assert.equal(hookIfMatches(bash, "Bash(npm*)"), false);
  assert.equal(hookIfMatches(bash, "Bash()"), false);
});

test("hookIfMatches escapes regex metacharacters in the input pattern", () => {
  const plus = toolContext("Bash", { command: "a+b" });

  assert.equal(hookIfMatches(plus, "Bash(a+b)"), true);
  assert.equal(hookIfMatches(toolContext("Bash", { command: "aab" }), "Bash(a+b)"), false);
});

test("hookIfMatches matches file paths for file tools", () => {
  const read = toolContext("Read", { path: "docs/guide.md" });

  assert.equal(hookIfMatches(read, "Read(*.md)"), true);
  assert.equal(hookIfMatches(read, "Read(*.ts)"), false);
  assert.equal(hookIfMatches(read, "Read(docs/*)"), true);
});

test("hookIfMatches dumps unknown tool input as JSON", () => {
  const custom = toolContext("custom_tool", { anything: true });

  assert.equal(hookIfMatches(custom, "custom_tool(*)"), true);
  assert.equal(hookIfMatches(custom, "custom_tool({*)"), true);
});

test("hookIfMatches only applies to tool events", () => {
  const stop: HookExecutionContext = {
    sessionId: "session.jsonl",
    cwd: "/work",
    hookEventName: "Stop",
    toolName: "Bash",
  };

  assert.equal(hookIfMatches(stop, "Bash"), false);
  assert.equal(hookIfMatches(stop, undefined), true);
});

test("hookIfMatches rejects a malformed condition", () => {
  assert.equal(hookIfMatches(bash, "("), false);
});

test("hookIfMatches matches an empty input value only with a bare glob", () => {
  const noInput = toolContext("Bash", undefined);

  assert.equal(hookIfMatches(noInput, "Bash(*)"), true);
  assert.equal(hookIfMatches(noInput, "Bash(git*)"), false);
});

test("parseJsonOutput ignores blank and non-JSON stdout", () => {
  assert.equal(parseJsonOutput(""), undefined);
  assert.equal(parseJsonOutput("   \n"), undefined);
  assert.equal(parseJsonOutput("not json"), undefined);
});

test("parseJsonOutput parses JSON with surrounding whitespace", () => {
  assert.deepEqual(parseJsonOutput('  {"a":1}\n'), { a: 1 });
});

test("getHookSpecificOutput requires an object payload", () => {
  assert.equal(getHookSpecificOutput("PreToolUse", {}), undefined);
  assert.equal(
    getHookSpecificOutput("PreToolUse", { hookSpecificOutput: null }),
    undefined,
  );
  assert.equal(
    getHookSpecificOutput("PreToolUse", { hookSpecificOutput: "deny" }),
    undefined,
  );
});

test("getHookSpecificOutput rejects a payload for another event", () => {
  const jsonOutput = {
    hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "x" },
  };

  assert.equal(getHookSpecificOutput("PreToolUse", jsonOutput), undefined);
  assert.deepEqual(getHookSpecificOutput("PostToolUse", jsonOutput), {
    hookEventName: "PostToolUse",
    additionalContext: "x",
  });
});

test("getHookSpecificOutput accepts a payload without hookEventName", () => {
  const jsonOutput = { hookSpecificOutput: { permissionDecision: "deny" } };

  assert.deepEqual(getHookSpecificOutput("PreToolUse", jsonOutput), {
    permissionDecision: "deny",
  });
});

test("extractCommonOutput reads the shared envelope fields", () => {
  const output = extractCommonOutput("Stop", {
    systemMessage: "heads up",
    suppressOutput: true,
    continue: false,
    stopReason: "done",
  });

  assert.equal(output.systemMessage, "heads up");
  assert.equal(output.suppressOutput, true);
  assert.equal(output.stopProcessing, true);
  assert.equal(output.stopReason, "done");
});

test("extractCommonOutput ignores blank and non-boolean fields", () => {
  const output = extractCommonOutput("Stop", {
    systemMessage: "   ",
    suppressOutput: "yes",
    continue: "no",
  });

  assert.equal(output.systemMessage, undefined);
  assert.equal(output.suppressOutput, false);
  assert.equal(output.stopProcessing, false);
  assert.equal(output.stopReason, undefined);
});

test("extractToolResultPatch reads updatedToolResult", () => {
  const patch = extractToolResultPatch("PostToolUse", {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      updatedToolResult: { content: "patched", details: { a: 1 }, isError: true },
    },
  });

  assert.deepEqual(patch, {
    content: "patched",
    details: { a: 1 },
    isError: true,
  });
});

test("extractToolResultPatch reads updatedMCPToolOutput as content", () => {
  const patch = extractToolResultPatch("PostToolUse", {
    hookSpecificOutput: { hookEventName: "PostToolUse", updatedMCPToolOutput: "mcp" },
  });

  assert.deepEqual(patch, { content: "mcp", details: undefined, isError: undefined });
});

test("extractToolResultPatch reads top-level fields", () => {
  const patch = extractToolResultPatch("PostToolUseFailure", {
    content: "top",
    details: { b: 2 },
    isError: false,
  });

  assert.deepEqual(patch, { content: "top", details: { b: 2 }, isError: false });
});

test("extractToolResultPatch ignores a non-boolean isError", () => {
  const patch = extractToolResultPatch("PostToolUse", { content: "x", isError: "yes" });

  assert.equal(patch.isError, undefined);
});

test("extractToolResultPatch returns an empty patch without fields", () => {
  assert.deepEqual(extractToolResultPatch("PostToolUse", {}), {
    content: undefined,
    details: undefined,
    isError: undefined,
  });
});

test("appendAdditionalContext concatenates with a newline", () => {
  assert.equal(appendAdditionalContext(undefined, undefined), undefined);
  assert.equal(appendAdditionalContext("first", undefined), "first");
  assert.equal(appendAdditionalContext("first", ""), "first");
  assert.equal(appendAdditionalContext(undefined, "second"), "second");
  assert.equal(appendAdditionalContext("first", "second"), "first\nsecond");
});
