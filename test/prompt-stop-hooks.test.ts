import assert from "node:assert/strict";
import { test } from "node:test";
import {
  registerPromptHooks,
  triggerUserPromptSubmitHooks,
} from "../src/hooks/prompt-hooks.ts";
import { triggerStopHooks } from "../src/hooks/stop-hooks.ts";
import type { HookExecutionContext } from "../src/types.ts";
import { createHookScript } from "./support/hook-script.ts";
import { recorder, settingsWith } from "./support/settings.ts";

function promptContext(prompt = "hello"): HookExecutionContext {
  return {
    sessionId: "session.jsonl",
    cwd: process.cwd(),
    hookEventName: "UserPromptSubmit",
    prompt,
  };
}

const stopContext: HookExecutionContext = {
  sessionId: "session.jsonl",
  cwd: process.cwd(),
  hookEventName: "Stop",
  stopHookActive: false,
  lastAssistantMessage: "done",
};

test("UserPromptSubmit blocks the prompt when the hook asks for it", async () => {
  const script = createHookScript(`  out({ decision: "block", reason: "not now" });`);
  try {
    const result = await triggerUserPromptSubmitHooks(
      promptContext(),
      settingsWith("UserPromptSubmit", { type: "command", command: script.command }),
    );

    assert.equal(result.blocked, true);
    assert.equal(result.reason, "not now");
  } finally {
    script.cleanup();
  }
});

test("UserPromptSubmit defaults the block reason", async () => {
  const script = createHookScript(`  out({ decision: "block" });`);
  try {
    const result = await triggerUserPromptSubmitHooks(
      promptContext(),
      settingsWith("UserPromptSubmit", { type: "command", command: script.command }),
    );

    assert.equal(result.blocked, true);
    assert.equal(result.reason, "Blocked by a hook");
  } finally {
    script.cleanup();
  }
});

test("UserPromptSubmit ignores an unknown decision and warns", async () => {
  const script = createHookScript(`  out({ decision: "maybe" });`);
  try {
    const { notify, messages } = recorder();

    const result = await triggerUserPromptSubmitHooks(
      promptContext(),
      settingsWith("UserPromptSubmit", { type: "command", command: script.command }),
      notify,
    );

    assert.equal(result.blocked, false);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.[1], "warning");
    assert.match(messages[0]?.[0] ?? "", /ignored an invalid decision: "maybe"/);
  } finally {
    script.cleanup();
  }
});

test("UserPromptSubmit collects additionalContext", async () => {
  const script = createHookScript(`
  out({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "extra context" } });`);
  try {
    const result = await triggerUserPromptSubmitHooks(
      promptContext(),
      settingsWith("UserPromptSubmit", { type: "command", command: script.command }),
    );

    assert.equal(result.blocked, false);
    assert.equal(result.additionalContext, "extra context");
  } finally {
    script.cleanup();
  }
});

test("UserPromptSubmit reports a failing hook as an error", async () => {
  const script = createHookScript(`  fail(4, "kaboom");`);
  try {
    const { notify, messages } = recorder();

    const result = await triggerUserPromptSubmitHooks(
      promptContext(),
      settingsWith("UserPromptSubmit", { type: "command", command: script.command }),
      notify,
    );

    assert.equal(result.blocked, false);
    assert.deepEqual(
      messages.map(([, type]) => type),
      ["error"],
    );
  } finally {
    script.cleanup();
  }
});

test("Stop blocks the end of the turn when the hook asks for it", async () => {
  const script = createHookScript(`  out({ decision: "block", reason: "keep going" });`);
  try {
    const result = await triggerStopHooks(
      stopContext,
      settingsWith("Stop", { type: "command", command: script.command }),
    );

    assert.equal(result.blocked, true);
    assert.equal(result.reason, "keep going");
  } finally {
    script.cleanup();
  }
});

test("Stop defaults the continuation reason", async () => {
  const script = createHookScript(`  out({ decision: "block" });`);
  try {
    const result = await triggerStopHooks(
      stopContext,
      settingsWith("Stop", { type: "command", command: script.command }),
    );

    assert.equal(result.blocked, true);
    assert.equal(result.reason, "Continuation requested by the Stop hook");
  } finally {
    script.cleanup();
  }
});

test("Stop ignores an unknown decision and warns", async () => {
  const script = createHookScript(`  out({ decision: "continue" });`);
  try {
    const { notify, messages } = recorder();

    const result = await triggerStopHooks(
      stopContext,
      settingsWith("Stop", { type: "command", command: script.command }),
      notify,
    );

    assert.equal(result.blocked, false);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.[1], "warning");
  } finally {
    script.cleanup();
  }
});

test("Stop collects additionalContext", async () => {
  const script = createHookScript(`
  out({ hookSpecificOutput: { hookEventName: "Stop", additionalContext: "by the way" } });`);
  try {
    const result = await triggerStopHooks(
      stopContext,
      settingsWith("Stop", { type: "command", command: script.command }),
    );

    assert.equal(result.additionalContext, "by the way");
  } finally {
    script.cleanup();
  }
});

test("prompt and stop hooks are inert without settings", async () => {
  assert.deepEqual(await triggerUserPromptSubmitHooks(promptContext(), undefined), {
    blocked: false,
  });
  assert.deepEqual(await triggerStopHooks(stopContext, undefined), { blocked: false });
});

function fakePi(): {
  pi: never;
  handlers: Map<string, (event: any, ctx: any) => Promise<any>>;
} {
  const handlers = new Map<string, (event: any, ctx: any) => Promise<any>>();
  const pi = {
    on: (name: string, handler: (event: any, ctx: any) => Promise<any>) => {
      handlers.set(name, handler);
      return () => {};
    },
  };
  return { pi: pi as never, handlers };
}

const handlerCtx = {
  cwd: process.cwd(),
  sessionManager: { getSessionFile: () => "session.jsonl" },
  ui: { notify: () => {} },
};

test("queued prompt contexts are consumed in order, one per run", async () => {
  // Two prompts can arrive before a run starts (steering, follow-ups). A single
  // pending slot meant the second overwrote the first and its context vanished.
  const { pi, handlers } = fakePi();
  const shared = {
    currentSettings: undefined,
    pendingUserPromptContexts: ["first", "second"],
    stopHookActive: false,
    getSessionId: () => "session.jsonl",
    notify: () => {},
    injectHiddenContext: () => {},
  };
  registerPromptHooks(pi, shared as never);

  const firstRun = await handlers.get("before_agent_start")?.({}, handlerCtx);
  const secondRun = await handlers.get("before_agent_start")?.({}, handlerCtx);
  const thirdRun = await handlers.get("before_agent_start")?.({}, handlerCtx);

  assert.equal(firstRun?.message.content, "first");
  assert.equal(secondRun?.message.content, "second");
  assert.equal(thirdRun, undefined);
});

test("a prompt arriving while another is pending keeps both contexts", async () => {
  const script = createHookScript(`
  out({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "from-hook" } });`);
  try {
    const { pi, handlers } = fakePi();
    const shared = {
      currentSettings: settingsWith("UserPromptSubmit", {
        type: "command",
        command: script.command,
      }),
      pendingUserPromptContexts: ["earlier"],
      stopHookActive: false,
      getSessionId: () => "session.jsonl",
      notify: () => {},
      injectHiddenContext: () => {},
    };
    registerPromptHooks(pi, shared as never);

    await handlers.get("input")?.({ text: "hola" }, handlerCtx);

    assert.deepEqual(shared.pendingUserPromptContexts, ["earlier", "from-hook"]);
  } finally {
    script.cleanup();
  }
});
