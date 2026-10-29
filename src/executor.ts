import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import type { Hook, HookExecutionContext } from "./types.ts";

// ============================================================================
// Hook executor
// ============================================================================

/**
 * Builds the Claude Code-style JSON input
 */
export function buildHookInput(ctx: HookExecutionContext): object {
  const base: Record<string, unknown> = {
    session_id: ctx.sessionId,
    cwd: ctx.cwd,
    hook_event_name: ctx.hookEventName,
    transcript_path: ctx.transcriptPath,
  };

  if (ctx.hookEventName === "PreCompact") {
    return {
      ...base,
      trigger: ctx.trigger,
      custom_instructions: ctx.customInstructions ?? "",
    };
  }

  if (ctx.hookEventName === "PostCompact") {
    return {
      ...base,
      trigger: ctx.trigger,
      compact_summary: ctx.compactSummary,
    };
  }

  if (ctx.hookEventName === "UserPromptSubmit") {
    return {
      ...base,
      prompt: ctx.prompt,
    };
  }

  if (ctx.hookEventName === "Stop") {
    return {
      ...base,
      stop_hook_active: ctx.stopHookActive ?? false,
      last_assistant_message: ctx.lastAssistantMessage ?? "",
    };
  }

  if (
    ctx.hookEventName === "PreToolUse" ||
    ctx.hookEventName === "PostToolUse" ||
    ctx.hookEventName === "PostToolUseFailure"
  ) {
    const toolInput: Record<string, unknown> = {
      ...base,
      tool_name: ctx.toolName,
      tool_input: ctx.toolInput,
      tool_use_id: ctx.toolUseId,
    };

    if (ctx.hookEventName === "PostToolUse") {
      toolInput.tool_response = ctx.toolResponse;
    }

    if (ctx.hookEventName === "PostToolUseFailure") {
      toolInput.error = ctx.error;
      if (ctx.isInterrupt !== undefined) {
        toolInput.is_interrupt = ctx.isInterrupt;
      }
    }

    return toolInput;
  }

  if (ctx.hookEventName === "SessionEnd") {
    return {
      ...base,
      reason: ctx.reason,
      model: ctx.model,
    };
  }

  return {
    ...base,
    source: ctx.source,
    model: ctx.model,
  };
}

export async function executeHook(
  hook: Hook,
  input: object,
  cwd: string,
  timeoutMs: number = 60000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const inputJson = JSON.stringify(input);
  return executeCommandHook(hook.command, inputJson, cwd, timeoutMs);
}

/** Upper bound for the stdout/stderr captured from a single hook. */
const MAX_CAPTURED_CHARS = 1_000_000;

type ShellSpec = { shell: string; flag: "-c" | "/c" };

let cachedShell: ShellSpec | undefined;
let configuredShellPath: string | undefined;

/**
 * Sets the `shellPath` for this session. `loadSettings` is the only reader of
 * the settings files, and this is how the executor consumes its decision: no
 * second read, one rule, and the project value already passed the trust gate.
 * Passing `undefined` drops the override and falls back to discovery, so a new
 * session cannot inherit the previous one's shell.
 */
export function configureShell(shellPath: string | undefined): void {
  configuredShellPath = shellPath;
  cachedShell = undefined;
}

/**
 * The shell hook commands run under — resolved once per configured shell.
 *
 * Bare "bash" is not safe on Windows: it resolves through PATH to the WSL
 * launcher (System32\bash.exe), which cannot see Node.js or Windows paths, so
 * every hook died with exit 127 (issue #3) — and on a host with no bash at all
 * the spawn itself fails. Resolution order:
 *   1. `shellPath` from the session settings (global, or a trusted project)
 *   2. known Git Bash / MSYS2 install locations
 *   3. COMSPEC (cmd.exe) — always present; runs the plain commands most hooks
 *      use (`node hook.cjs …`) instead of dying before the hook even starts.
 *      PATH "bash" is deliberately NOT tried on Windows: it is the WSL
 *      launcher in practice, and a user with bash elsewhere can set shellPath.
 * POSIX keeps "bash -c" exactly as before.
 */
export function resolveShell(): ShellSpec {
  if (cachedShell) return cachedShell;
  if (configuredShellPath && existsSync(configuredShellPath)) {
    return (cachedShell = { shell: configuredShellPath, flag: "-c" });
  }
  if (process.platform === "win32") {
    const gitBash = [
      process.env.ProgramFiles,
      process.env["ProgramFiles(x86)"],
    ]
      .filter((root): root is string => !!root)
      .map((root) => `${root}/Git/bin/bash.exe`)
      .concat("C:/msys64/usr/bin/bash.exe")
      .find((p) => existsSync(p));
    if (gitBash) return (cachedShell = { shell: gitBash, flag: "-c" });
    return (cachedShell = {
      shell: process.env.ComSpec || "cmd.exe",
      flag: "/c",
    });
  }
  return (cachedShell = { shell: "bash", flag: "-c" });
}

/**
 * Kills the hook and everything it started.
 *
 * The spawned child is the shell (`bash -c` / `cmd /c`), not the command, so
 * `child.kill()` only reaped the shell: the command kept running, kept the
 * stdio pipes open and, on Windows, kept the working directory from being
 * cleaned up. A hook that hangs would leave a live process behind forever.
 */
function killProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) return;

  if (process.platform === "win32") {
    // Windows has no process groups; taskkill walks the tree instead. It is a
    // system tool, and if it is not there we still kill what we know about.
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.on("error", () => child.kill());
    return;
  }

  try {
    // Negative pid signals the whole process group created by `detached`.
    process.kill(-pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

function executeCommandHook(
  command: string,
  inputJson: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const { shell, flag } = resolveShell();
    const child = spawn(shell, [flag, command], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      // On POSIX this makes the shell a process-group leader, which is what
      // lets a timeout signal the whole group instead of just the shell.
      detached: process.platform !== "win32",
    });

    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;

    // A hook can print without limit, and everything captured lives in the Pi
    // process until the hook ends. Cap it so a runaway hook cannot grow the
    // host's memory; the marker keeps the truncation visible to whoever reads
    // the output instead of silently losing the tail.
    const capture = (
      current: string,
      truncated: boolean,
      chunk: Buffer,
    ): [string, boolean] => {
      if (truncated) return [current, true];
      const next = current + chunk.toString();
      if (next.length <= MAX_CAPTURED_CHARS) return [next, false];
      return [next.slice(0, MAX_CAPTURED_CHARS), true];
    };

    const withTruncationNote = (text: string, truncated: boolean) =>
      truncated
        ? `${text}\n[pi-hooks] output truncated at ${MAX_CAPTURED_CHARS} characters`
        : text;

    const finish = (result: { stdout: string; stderr: string; exitCode: number }) => {
      if (settled) return;
      settled = true;
      resolve({
        ...result,
        stdout: withTruncationNote(result.stdout, stdoutTruncated),
        stderr: withTruncationNote(result.stderr, stderrTruncated),
      });
    };

    child.stdout.on("data", (data) => {
      [stdout, stdoutTruncated] = capture(stdout, stdoutTruncated, data);
    });

    child.stderr.on("data", (data) => {
      [stderr, stderrTruncated] = capture(stderr, stderrTruncated, data);
    });

    // A hook that exits without reading its payload closes the pipe, and the
    // write then fails with EOF/EPIPE. That is not a failure worth reporting:
    // the exit code and stderr still describe what the hook decided. Without a
    // listener the stream raises it as an uncaught exception, and the host
    // process goes down with it — a 256 KB tool_response is enough to trigger
    // that against a one-line `exit 2` hook.
    child.stdin.on("error", () => {});
    try {
      child.stdin.write(inputJson);
      child.stdin.end();
    } catch {
      // Same case, raised synchronously: the stream was already closed.
    }

    const timeout = setTimeout(() => {
      killProcessTree(child);
      finish({
        stdout,
        stderr: `${stderr}\n[pi-hooks] Hook timed out after ${timeoutMs} ms`.trim(),
        exitCode: 1,
      });
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timeout);
      finish({
        stdout,
        stderr,
        exitCode: code ?? 1,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      finish({
        stdout,
        stderr: err.message,
        exitCode: 1,
      });
    });
  });
}
