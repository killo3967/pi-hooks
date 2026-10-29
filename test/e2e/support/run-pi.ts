import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Locates the Pi launcher, or undefined when Pi is not installed. The e2e tests
 * skip themselves in that case: they need a real Pi to mean anything, and CI
 * runs without one.
 */
export function findPiLauncher(): string | undefined {
  const candidate =
    process.env.PI_LAUNCHER ?? path.join(os.homedir(), ".pi", "agent", "bin", "pi-launcher.js");
  return existsSync(candidate) ? candidate : undefined;
}

export type PiRun = {
  code: number;
  stdout: string;
  stderr: string;
  /** Parsed JSONL events Pi reported; empty when the run produced nothing. */
  events: Array<Record<string, unknown>>;
};

/**
 * Runs Pi against the playground. Non-interactive and with stdin closed: Pi
 * waits for EOF when stdin is a pipe, which never arrives from a spawned child.
 */
export function runPi(options: {
  launcher: string;
  projectDir: string;
  agentDir: string;
  prompt: string;
  extension: string;
  /** Grant project trust for this run, the way `--approve` does. */
  approve?: boolean;
  /** Decline project trust explicitly, the way `--no-approve` does. */
  rejectTrust?: boolean;
  timeoutMs?: number;
}): Promise<PiRun> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        options.launcher,
        "--mode",
        "json",
        "-p",
        "--no-extensions",
        "-e",
        options.extension,
        "--model",
        "stub/stub-model",
        ...(options.approve ? ["--approve"] : []),
        ...(options.rejectTrust ? ["--no-approve"] : []),
        options.prompt,
      ],
      {
        cwd: options.projectDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PI_CODING_AGENT_DIR: options.agentDir,
          PI_OFFLINE: "1",
        },
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (piece) => {
      stdout += piece;
    });
    child.stderr.on("data", (piece) => {
      stderr += piece;
    });

    const timer = setTimeout(() => child.kill(), options.timeoutMs ?? 60_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      const events: Array<Record<string, unknown>> = [];
      for (const line of stdout.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        try {
          events.push(JSON.parse(line) as Record<string, unknown>);
        } catch {
          // A partial line from the killed run is not an event.
        }
      }
      resolve({ code: code ?? -1, stdout, stderr, events });
    });
  });
}
