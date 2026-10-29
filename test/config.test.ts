import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  getHookGroups,
  matcherMatches,
  mergeHooks,
  readSettingsFile,
} from "../src/config.ts";
import type { HookGroup } from "../src/types.ts";

function group(command: string, matcher?: string): HookGroup {
  return { matcher, hooks: [{ type: "command", command }] };
}

function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pi-hooks-config-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("matcherMatches accepts the wildcard forms", () => {
  assert.equal(matcherMatches(undefined, "Bash"), true);
  assert.equal(matcherMatches("", "Bash"), true);
  assert.equal(matcherMatches("*", "Bash"), true);
});

test("matcherMatches treats the matcher as an unanchored regex", () => {
  assert.equal(matcherMatches("bash", "bash"), true);
  assert.equal(matcherMatches("ash", "bash"), true);
  assert.equal(matcherMatches("Bash|Read", "Read"), true);
  assert.equal(matcherMatches("Bash|Read", "Write"), false);
  // Claude Code matchers are case-sensitive regexes.
  assert.equal(matcherMatches("bash", "Bash"), false);
});

test("matcherMatches falls back to exact equality on an invalid regex", () => {
  assert.equal(matcherMatches("[", "["), true);
  assert.equal(matcherMatches("[", "Bash"), false);
});

test("getHookGroups returns an empty list without settings", () => {
  assert.deepEqual(getHookGroups(undefined, "PreToolUse"), []);
  assert.deepEqual(getHookGroups({}, "PreToolUse"), []);
});

test("getHookGroups merges PascalCase and snake_case spellings in order", () => {
  const settings = {
    hooks: {
      PreToolUse: [group("pascal")],
      pre_tool_use: [group("snake")],
    },
  };

  const groups = getHookGroups(settings, "PreToolUse");

  assert.deepEqual(
    groups.map((g) => g.hooks?.[0]?.command),
    ["pascal", "snake"],
  );
});

test("getHookGroups reads each event from its own keys only", () => {
  const settings = {
    hooks: {
      Stop: [group("stop")],
      stop: [group("stop-lower")],
      UserPromptSubmit: [group("prompt")],
    },
  };

  assert.deepEqual(
    getHookGroups(settings, "Stop").map((g) => g.hooks?.[0]?.command),
    ["stop", "stop-lower"],
  );
  assert.deepEqual(
    getHookGroups(settings, "UserPromptSubmit").map((g) => g.hooks?.[0]?.command),
    ["prompt"],
  );
  assert.deepEqual(getHookGroups(settings, "SessionStart"), []);
});

test("readSettingsFile returns undefined for a missing file", () => {
  const { dir, cleanup } = tempDir();
  try {
    assert.equal(readSettingsFile(path.join(dir, "absent.json")), undefined);
  } finally {
    cleanup();
  }
});

test("readSettingsFile returns undefined for invalid JSON", () => {
  const { dir, cleanup } = tempDir();
  const file = path.join(dir, "settings.json");
  try {
    writeFileSync(file, "{ not json", "utf8");
    assert.equal(readSettingsFile(file), undefined);
  } finally {
    cleanup();
  }
});

test("readSettingsFile returns undefined for a non-object document", () => {
  const { dir, cleanup } = tempDir();
  const file = path.join(dir, "settings.json");
  try {
    writeFileSync(file, "null", "utf8");
    assert.equal(readSettingsFile(file), undefined);
  } finally {
    cleanup();
  }
});

test("readSettingsFile reads a valid settings document", () => {
  const { dir, cleanup } = tempDir();
  const file = path.join(dir, "settings.json");
  try {
    writeFileSync(file, JSON.stringify({ shellPath: "/bin/bash" }), "utf8");
    assert.deepEqual(readSettingsFile(file), { shellPath: "/bin/bash" });
  } finally {
    cleanup();
  }
});

test("mergeHooks returns undefined when neither side has hooks", () => {
  assert.equal(mergeHooks(undefined, undefined), undefined);
  assert.equal(mergeHooks({ PreToolUse: [] }, {}), undefined);
  assert.equal(mergeHooks({}, { Stop: [] }), undefined);
});

test("mergeHooks concatenates global then project groups", () => {
  const merged = mergeHooks(
    { PreToolUse: [group("global")] },
    { PreToolUse: [group("project")], Stop: [group("stop")] },
  );

  assert.deepEqual(
    merged?.PreToolUse?.map((g) => g.hooks?.[0]?.command),
    ["global", "project"],
  );
  assert.deepEqual(merged?.Stop?.map((g) => g.hooks?.[0]?.command), ["stop"]);
});

test("mergeHooks drops keys it does not know", () => {
  const merged = mergeHooks(
    { NotAnEvent: [group("ignored")] } as never,
    undefined,
  );

  assert.equal(merged, undefined);
});

test("readSettingsFile rejects a document that is not an object", () => {
  const { dir, cleanup } = tempDir();
  const file = path.join(dir, "settings.json");
  try {
    writeFileSync(file, "[]", "utf8");
    assert.equal(readSettingsFile(file), undefined);
  } finally {
    cleanup();
  }
});

test("readSettingsFile rejects a malformed hooks value", () => {
  const { dir, cleanup } = tempDir();
  const file = path.join(dir, "settings.json");
  try {
    writeFileSync(file, JSON.stringify({ hooks: "not-an-object" }), "utf8");
    assert.equal(readSettingsFile(file), undefined);
  } finally {
    cleanup();
  }
});

test("readSettingsFile rejects a non-string shellPath", () => {
  const { dir, cleanup } = tempDir();
  const file = path.join(dir, "settings.json");
  try {
    writeFileSync(file, JSON.stringify({ shellPath: 42 }), "utf8");
    assert.equal(readSettingsFile(file), undefined);
  } finally {
    cleanup();
  }
});
