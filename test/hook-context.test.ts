import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createHookContext } from "../src/hook-context.ts";
import type { HookMatcherValue } from "../src/types.ts";
import { createHookScript, type HookScript } from "./support/hook-script.ts";
import { settingsWith } from "./support/settings.ts";

const ctx = {
  cwd: process.cwd(),
  sessionManager: { getSessionFile: () => "session.jsonl" },
  ui: { notify: () => {} },
};

function fakePi(): ExtensionAPI {
  return { sendMessage: () => {} } as unknown as ExtensionAPI;
}

/** A SessionStart hook that appends one line per run, so runs can be counted. */
function countingScript(): { script: HookScript; runs: () => number } {
  const script = createHookScript(
    `  require("node:fs").appendFileSync(__dirname + "/runs.txt", "run");`,
  );
  return {
    script,
    runs: () => {
      try {
        const text = readFileSync(path.join(script.dir, "runs.txt"), "utf8");
        return (text.match(/run/g) ?? []).length;
      } catch {
        return 0;
      }
    },
  };
}

async function runTwice(matcher: HookMatcherValue<"SessionStart">): Promise<number> {
  const { script, runs } = countingScript();
  try {
    const shared = createHookContext(fakePi());
    shared.currentSettings = settingsWith(
      "SessionStart",
      { type: "command", command: script.command },
      matcher,
    );

    await shared.triggerSessionStartHook(matcher, ctx);
    await shared.triggerSessionStartHook(matcher, ctx);

    return runs();
  } finally {
    script.cleanup();
  }
}

test("SessionStart startup runs once per session even if the event repeats", async () => {
  assert.equal(await runTwice("startup"), 1);
});

test("SessionStart resume runs once per session even if the event repeats", async () => {
  assert.equal(await runTwice("resume"), 1);
});

test("every compaction fires SessionStart compact, not just the first", async () => {
  // Pi emits session_compact once per compaction, and a long session can
  // compact many times. Deduping this matcher meant the hook ran once and then
  // silently stopped.
  assert.equal(await runTwice("compact"), 2);
});

test("a SessionStart injection adds a short visible notice next to the hidden content", async () => {
  // The content stays hidden from the transcript, but an automatic injection
  // must leave a visible trace: a model that is being steered invisibly is
  // exactly the failure mode this guards against.
  const sent: Array<Record<string, unknown>> = [];
  const shared = createHookContext({
    sendMessage: (message: Record<string, unknown>) => {
      sent.push(message);
    },
  } as never);

  shared.injectHiddenContext("line one\nline two", { hookEventName: "SessionStart" });

  assert.equal(sent.length, 2);
  assert.equal(sent[0]?.display, false);
  assert.equal(sent[0]?.content, "line one\nline two");
  assert.equal(sent[1]?.display, true);
  assert.match(String(sent[1]?.content), /SessionStart/);
  assert.match(String(sent[1]?.content), /2 lines/);
});

test("tool-level context stays hidden without a notice", () => {
  const sent: Array<Record<string, unknown>> = [];
  const shared = createHookContext({
    sendMessage: (message: Record<string, unknown>) => {
      sent.push(message);
    },
  } as never);

  shared.injectHiddenContext("tool context", {
    hookEventName: "PostToolUse",
    toolName: "bash",
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.display, false);
});

test("starting a session clears context queued for the previous one", async () => {
  const shared = createHookContext(fakePi());
  shared.pendingUserPromptContexts.push("stale from previous session");

  shared.initSettings(process.cwd(), false);

  assert.deepEqual(shared.pendingUserPromptContexts, []);
});
