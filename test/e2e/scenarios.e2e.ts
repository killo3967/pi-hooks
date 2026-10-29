import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createPlayground } from "./support/playground.ts";
import { findPiLauncher, runPi } from "./support/run-pi.ts";
import { startStubModel } from "./stub-model.ts";

// End-to-end: a real Pi process, the real extension, and a stub model that
// replies from a script. Nothing here is mocked at the extension boundary, which
// is the point - these tests are the only ones that prove Pi actually loads
// pi-hooks and that a decision reaches it.
//
// Run with: pnpm test:e2e

const launcher = findPiLauncher();
const extensionPath = path.resolve("src/pi-hooks.ts");

/** The Pi-checked prompt every scenario sends. */
const PROMPT = "Haz lo que se te pide.";

/**
 * A hook that records the payload it received, then prints `output` and exits.
 * Recording instead of inspecting Pi's own output keeps the assertions about
 * what the hook saw, not about how Pi worded its transcript.
 */
function recordingHook(marker: string, output: Record<string, unknown>, exitCode = 0): string {
  return [
    'const fs = require("node:fs");',
    'let body = "";',
    'process.stdin.on("data", (chunk) => { body += chunk; });',
    'process.stdin.on("end", () => {',
    `  fs.writeFileSync(${JSON.stringify(marker)}, body);`,
    `  process.stdout.write(${JSON.stringify(JSON.stringify(output))});`,
    `  process.exit(${exitCode});`,
    "});",
  ].join("\n");
}

function readMarker(projectDir: string, name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(projectDir, name), "utf8")) as Record<string, unknown>;
}

test("e2e: a denied tool call is blocked and the run continues", { skip: !launcher }, async () => {
  const stub = await startStubModel([
    { toolCall: { name: "bash", arguments: { command: "echo hola" } } },
    { text: "terminado" },
  ]);
  const playground = createPlayground({
    modelPort: Number(new URL(stub.url).port),
    hooks: {
      PreToolUse: [
        {
          matcher: "bash",
          hooks: [
            {
              type: "command",
              command: `"${process.execPath}" deny-hook.cjs`,
            },
          ],
        },
      ],
    },
    files: {
      "deny-hook.cjs": recordingHook("seen-deny.json", {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "e2e says no",
        },
      }),
    },
  });

  try {
    const run = await runPi({
      launcher: launcher!,
      projectDir: playground.projectDir,
      agentDir: playground.agentDir,
      prompt: PROMPT,
      extension: extensionPath,
      approve: true,
    });

    const seen = readMarker(playground.projectDir, "seen-deny.json");
    assert.equal(seen.hook_event_name, "PreToolUse");
    assert.equal(seen.tool_name, "bash");
    assert.equal((seen.tool_input as Record<string, unknown>).command, "echo hola");

    // Two requests: the tool-call turn, then the turn after the block. A blocked
    // call that killed the run would show only one.
    assert.ok(stub.requests.length >= 2, `requests: ${stub.requests.length}`);
    assert.equal(run.code, 0);
  } finally {
    await stub.close();
    playground.cleanup();
  }
});

test("e2e: a Stop hook asks for another turn", { skip: !launcher }, async () => {
  const stub = await startStubModel([{ text: "primero" }, { text: "segundo" }]);
  const playground = createPlayground({
    modelPort: Number(new URL(stub.url).port),
    hooks: {
      Stop: [
        {
          hooks: [{ type: "command", command: `"${process.execPath}" stop-hook.cjs` }],
        },
      ],
    },
    files: {
      // Blocks only the first time: the marker keeps the second agent_end from
      // asking for a third turn forever.
      "stop-hook.cjs": [
        'const fs = require("node:fs");',
        'let body = "";',
        'process.stdin.on("data", (chunk) => { body += chunk; });',
        'process.stdin.on("end", () => {',
        '  const first = !fs.existsSync("seen-stop.json");',
        '  fs.writeFileSync("seen-stop.json", body);',
        '  if (first) {',
        '    process.stdout.write(JSON.stringify({ decision: "block", reason: "e2e keeps going" }));',
        "  }",
        "});",
      ].join("\n"),
    },
  });

  try {
    const run = await runPi({
      launcher: launcher!,
      projectDir: playground.projectDir,
      agentDir: playground.agentDir,
      prompt: PROMPT,
      extension: extensionPath,
      approve: true,
    });

    const seen = readMarker(playground.projectDir, "seen-stop.json");
    assert.equal(seen.hook_event_name, "Stop");
    assert.ok(stub.requests.length >= 2, `requests: ${stub.requests.length}`);
    assert.equal(run.code, 0);
  } finally {
    await stub.close();
    playground.cleanup();
  }
});

test("e2e: prompt context reaches the model", { skip: !launcher }, async () => {
  const stub = await startStubModel([{ text: "ok" }]);
  const playground = createPlayground({
    modelPort: Number(new URL(stub.url).port),
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [{ type: "command", command: `"${process.execPath}" prompt-hook.cjs` }],
        },
      ],
    },
    files: {
      "prompt-hook.cjs": recordingHook("seen-prompt.json", {
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: "CONTEXTO-DE-E2E",
        },
      }),
    },
  });

  try {
    const run = await runPi({
      launcher: launcher!,
      projectDir: playground.projectDir,
      agentDir: playground.agentDir,
      prompt: PROMPT,
      extension: extensionPath,
      approve: true,
    });

    const seen = readMarker(playground.projectDir, "seen-prompt.json");
    assert.equal(seen.hook_event_name, "UserPromptSubmit");
    assert.equal(seen.prompt, PROMPT);

    // The context is injected into the conversation, so the model request must
    // carry it: that is the whole point of additionalContext.
    const serialised = JSON.stringify(stub.requests);
    assert.ok(serialised.includes("CONTEXTO-DE-E2E"), "the model never saw the context");
    assert.equal(run.code, 0);
  } finally {
    await stub.close();
    playground.cleanup();
  }
});

test("e2e: the extension loads without errors", { skip: !launcher }, async () => {
  const stub = await startStubModel([{ text: "ok" }]);
  const playground = createPlayground({ modelPort: Number(new URL(stub.url).port) });

  try {
    const run = await runPi({
      launcher: launcher!,
      projectDir: playground.projectDir,
      agentDir: playground.agentDir,
      prompt: PROMPT,
      extension: extensionPath,
      approve: true,
    });

    assert.doesNotMatch(run.stderr, /Extension error/i);
    assert.doesNotMatch(run.stderr, /stale after session replacement/i);
    assert.equal(run.code, 0);
  } finally {
    await stub.close();
    playground.cleanup();
  }
});

test("e2e: project hooks do not run without project trust", { skip: !launcher }, async () => {
  // The security fix, verified where it matters: a repository can ship a
  // .pi/settings.json full of hooks, and none of them may run until the user
  // approves the folder.
  const stub = await startStubModel([{ text: "ok" }]);
  const playground = createPlayground({
    modelPort: Number(new URL(stub.url).port),
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [{ type: "command", command: `"${process.execPath}" untrusted-hook.cjs` }],
        },
      ],
    },
    files: {
      "untrusted-hook.cjs": recordingHook("seen-untrusted.json", {}),
    },
  });

  try {
    const run = await runPi({
      launcher: launcher!,
      projectDir: playground.projectDir,
      agentDir: playground.agentDir,
      prompt: PROMPT,
      extension: extensionPath,
      rejectTrust: true,
    });

    assert.equal(run.code, 0);
    assert.equal(
      existsSync(path.join(playground.projectDir, "seen-untrusted.json")),
      false,
      "a project hook ran without project trust",
    );
  } finally {
    await stub.close();
    playground.cleanup();
  }
});
