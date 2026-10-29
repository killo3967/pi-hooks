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
