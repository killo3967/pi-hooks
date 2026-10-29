import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type HookScript = {
  /** A shell-safe command line that runs the script through the hook shell. */
  command: string;
  dir: string;
  cleanup: () => void;
};

/**
 * Quotes a path for the shells a hook may run under (`sh -c` on POSIX,
 * `cmd /c` on a Windows host without Git Bash). Double quotes are valid in
 * both, and forward slashes keep Git Bash from eating the backslashes.
 */
function quote(value: string): string {
  return `"${value.replace(/\\/g, "/")}"`;
}

const PRELUDE = `let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const payload = JSON.parse(input);
  const out = (value) => process.stdout.write(JSON.stringify(value));
  const raw = (text) => process.stdout.write(text);
  const fail = (code, message) => { process.stderr.write(message); process.exit(code); };
`;

function writeScript(source: string): HookScript {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pi-hooks-test-"));
  const scriptPath = path.join(dir, "hook.cjs");
  writeFileSync(scriptPath, source, "utf8");

  return {
    command: `${quote(process.execPath)} ${quote(scriptPath)}`,
    dir,
    // Windows may still hold the script file right after a killed hook, so the
    // removal retries instead of failing the test that already passed.
    cleanup: () =>
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  };
}

/**
 * Writes a throwaway CommonJS hook script that receives the hook payload on
 * stdin and runs `body` inside the stdin `end` handler, where `payload`,
 * `out`, `raw` and `fail` are in scope.
 *
 * Tests execute it through the real executor: no module mocking, so the shell
 * resolution, the stdin write and the output parsing are all exercised.
 */
export function createHookScript(body: string): HookScript {
  return writeScript(`${PRELUDE}${body}\n});\n`);
}

/**
 * Writes a hook script that runs `source` verbatim, with no stdin handling at
 * all — the shape of a real hook that decides without reading its payload
 * (`exit 2`, a one-line shell block, a command that fails to start).
 */
export function createRawScript(source: string): HookScript {
  return writeScript(`${source}\n`);
}
