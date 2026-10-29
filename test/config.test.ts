import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  getHookGroups,
  loadSettings,
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

test("loadSettings ignores project settings unless the project is trusted", () => {
  const { dir, cleanup } = tempDir();
  try {
    const projectPi = path.join(dir, ".pi");
    mkdirSync(projectPi, { recursive: true });
    const projectSettings = path.join(projectPi, "settings.json");
    writeFileSync(
      projectSettings,
      JSON.stringify({
        hooks: {
          PreToolUse: [{ hooks: [{ type: "command", command: "echo from-project" }] }],
        },
      }),
      "utf8",
    );

    const absentGlobal = path.join(dir, "no-global.json");
    const untrusted = loadSettings(dir, { projectTrusted: false, globalSettingsPath: absentGlobal });
    assert.equal(untrusted.settings, undefined);
    assert.deepEqual(untrusted.sourcePaths, []);

    const trusted = loadSettings(dir, { projectTrusted: true, globalSettingsPath: absentGlobal });
    assert.deepEqual(
      trusted.settings?.hooks?.PreToolUse?.flatMap((g) => g.hooks?.map((h) => h.command) ?? []),
      ["echo from-project"],
    );
    assert.deepEqual(trusted.sourcePaths, [projectSettings]);
  } finally {
    cleanup();
  }
});

test("global hooks still load when the project is not trusted", () => {
  const { dir, cleanup } = tempDir();
  try {
    const globalSettings = path.join(dir, "global.json");
    writeFileSync(
      globalSettings,
      JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: "command", command: "echo from-global" }] }] },
      }),
      "utf8",
    );
    const projectPi = path.join(dir, ".pi");
    mkdirSync(projectPi, { recursive: true });
    writeFileSync(
      path.join(projectPi, "settings.json"),
      JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: "command", command: "echo from-project" }] }] },
      }),
      "utf8",
    );

    const untrusted = loadSettings(dir, { projectTrusted: false, globalSettingsPath: globalSettings });

    assert.deepEqual(
      untrusted.settings?.hooks?.Stop?.flatMap((g) => g.hooks?.map((h) => h.command) ?? []),
      ["echo from-global"],
    );
    assert.deepEqual(untrusted.sourcePaths, [globalSettings]);
  } finally {
    cleanup();
  }
});

test("getHookGroups ignores malformed groups instead of throwing", () => {
  // A null or mistyped entry used to escape the try/catch in the tool hooks and
  // Pi then blocks the tool as a fail-safe: one bad entry disabled every tool.
  const settings = {
    hooks: { PreToolUse: [null, "nope", { hooks: "bad" }] },
  } as never;

  assert.deepEqual(getHookGroups(settings, "PreToolUse"), []);
});

test("getHookGroups keeps command hooks and drops everything else", () => {
  const settings = {
    hooks: {
      PreToolUse: [
        {
          hooks: [
            null,
            { type: "prompt", command: "echo prompt" },
            { type: "command" },
            { type: "command", command: "   " },
            { type: "command", command: "echo ok" },
          ],
        },
      ],
    },
  } as never;

  const groups = getHookGroups(settings, "PreToolUse");

  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0]?.hooks?.map((hook) => hook.command),
    ["echo ok"],
  );
});

test("getHookGroups drops groups whose matcher is not a string", () => {
  const settings = {
    hooks: { Stop: [{ matcher: 42, hooks: [{ type: "command", command: "echo hi" }] }] },
  } as never;

  assert.deepEqual(getHookGroups(settings, "Stop"), []);
});
