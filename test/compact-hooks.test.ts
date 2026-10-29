import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  registerCompactHooks,
  toCompactTrigger,
} from "../src/hooks/compact-hooks.ts";
import type { HookModuleContext } from "../src/hook-context.ts";
import type { Hook, HooksConfig, SettingsFile } from "../src/types.ts";
import { createHookScript, type HookScript } from "./support/hook-script.ts";
import { recorder, settingsWith } from "./support/settings.ts";

const ctx = {
  cwd: process.cwd(),
  sessionManager: { getSessionFile: () => "session.jsonl" },
  ui: { notify: () => {} },
};

function fakePi(): {
  pi: ExtensionAPI;
  handlers: Map<string, (event: any, ctx: any) => Promise<unknown>>;
} {
  const handlers = new Map<string, (event: any, ctx: any) => Promise<unknown>>();
  const pi = {
    on: (name: string, handler: (event: any, ctx: any) => Promise<unknown>) => {
      handlers.set(name, handler);
      return () => {};
    },
  };
  return { pi: pi as unknown as ExtensionAPI, handlers };
}

function fakeShared(settings: SettingsFile | undefined): {
  shared: HookModuleContext;
  sessionStartCalls: string[];
} {
  const sessionStartCalls: string[] = [];
  const { notify } = recorder();
  const shared = {
    currentSettings: settings,
    firedSessionStartKeys: new Set<string>(),
    stopHookActive: false,
    getSessionId: () => "session.jsonl",
    notify: (_ctx: unknown, message: string, type: "info" | "error" | "warning") =>
      notify(message, type),
    injectHiddenContext: () => {},
    initSettings: () => settings,
    buildToolResponse: () => ({}),
    triggerSessionStartHook: async (matcher: string) => {
      sessionStartCalls.push(matcher);
    },
  };
  return { shared: shared as unknown as HookModuleContext, sessionStartCalls };
}

/** A hook that records the payload it received, so tests can assert the input. */
function recordingScript(): { script: HookScript; seen: () => Record<string, unknown> } {
  const script = createHookScript(
    `  require("node:fs").writeFileSync(__dirname + "/seen.json", JSON.stringify(payload));`,
  );
  return {
    script,
    seen: () => JSON.parse(readFileSync(path.join(script.dir, "seen.json"), "utf8")),
  };
}

function compactionSettings(event: keyof HooksConfig, hook: Hook, matcher: string): SettingsFile {
  return settingsWith(event, hook, matcher);
}

test("toCompactTrigger folds Pi's three reasons into manual/auto", () => {
  assert.equal(toCompactTrigger("manual"), "manual");
  assert.equal(toCompactTrigger("threshold"), "auto");
  assert.equal(toCompactTrigger("overflow"), "auto");
  assert.equal(toCompactTrigger(undefined), "manual");
});

test("an automatic PreCompact hook sees trigger auto and matches an auto matcher", async () => {
  const { script, seen } = recordingScript();
  try {
    const { pi, handlers } = fakePi();
    const { shared } = fakeShared(
      compactionSettings("PreCompact", { type: "command", command: script.command }, "auto"),
    );
    registerCompactHooks(pi, shared);

    await handlers.get("session_before_compact")?.(
      { reason: "overflow", customInstructions: "keep it short" },
      ctx,
    );

    assert.equal(seen().trigger, "auto");
    assert.equal(seen().hook_event_name, "PreCompact");
    assert.equal(seen().custom_instructions, "keep it short");
  } finally {
    script.cleanup();
  }
});

test("a manual PreCompact hook still sees trigger manual", async () => {
  const { script, seen } = recordingScript();
  try {
    const { pi, handlers } = fakePi();
    const { shared } = fakeShared(
      compactionSettings("PreCompact", { type: "command", command: script.command }, "manual"),
    );
    registerCompactHooks(pi, shared);

    await handlers.get("session_before_compact")?.(
      { reason: "manual", customInstructions: "" },
      ctx,
    );

    assert.equal(seen().trigger, "manual");
  } finally {
    script.cleanup();
  }
});

test("a threshold PostCompact hook sees trigger auto and the summary", async () => {
  const { script, seen } = recordingScript();
  try {
    const { pi, handlers } = fakePi();
    const { shared, sessionStartCalls } = fakeShared(
      compactionSettings("PostCompact", { type: "command", command: script.command }, "auto"),
    );
    registerCompactHooks(pi, shared);

    await handlers.get("session_compact")?.(
      { reason: "threshold", compactionEntry: { summary: "the summary" } },
      ctx,
    );

    assert.equal(seen().trigger, "auto");
    assert.equal(seen().hook_event_name, "PostCompact");
    assert.equal(seen().compact_summary, "the summary");
    assert.deepEqual(sessionStartCalls, ["compact"]);
  } finally {
    script.cleanup();
  }
});
