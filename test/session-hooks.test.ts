import assert from "node:assert/strict";
import { test } from "node:test";
import { triggerSessionHooks } from "../src/hooks/session-hooks.ts";
import type { HookExecutionContext } from "../src/types.ts";
import { createHookScript } from "./support/hook-script.ts";
import { recorder, settingsWith } from "./support/settings.ts";

const startContext: HookExecutionContext = {
  sessionId: "session.jsonl",
  cwd: process.cwd(),
  hookEventName: "SessionStart",
  source: "startup",
};

test("SessionStart folds plain stdout into additionalContext", async () => {
  const script = createHookScript(`  raw("remember the conventions");`);
  try {
    const result = await triggerSessionHooks(
      "SessionStart",
      "startup",
      startContext,
      settingsWith("SessionStart", { type: "command", command: script.command }),
    );

    assert.equal(result.additionalContext, "remember the conventions");
  } finally {
    script.cleanup();
  }
});

test("a failing session hook names its event in the notification", async () => {
  const script = createHookScript(`  fail(4, "boom");`);
  try {
    const { notify, messages } = recorder();

    await triggerSessionHooks(
      "SessionStart",
      "startup",
      startContext,
      settingsWith("SessionStart", { type: "command", command: script.command }),
      notify,
    );

    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.[1], "error");
    assert.equal(messages[0]?.[0], "SessionStart hook failed (exit 4): boom");
  } finally {
    script.cleanup();
  }
});
