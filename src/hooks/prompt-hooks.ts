import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getHookGroups } from "../config.ts";
import type { HookModuleContext } from "../hook-context.ts";
import type {
  HookExecutionContext,
  NotifyFn,
  SettingsFile,
  UserPromptSubmitResult,
} from "../types.ts";
import {
  appendAdditionalContext,
  executeParsedHook,
  getStringField,
  hookIfMatches,
} from "./shared.ts";

export async function triggerUserPromptSubmitHooks(
  context: HookExecutionContext,
  settings: SettingsFile | undefined,
  notify?: NotifyFn,
): Promise<UserPromptSubmitResult> {
  const groups = getHookGroups(settings, "UserPromptSubmit");
  const result: UserPromptSubmitResult = { blocked: false };

  for (const group of groups) {
    for (const hook of group.hooks ?? []) {
      if (hook.if && !hookIfMatches(context, hook.if)) continue;

      try {
        const { hookResult, plainStdout, jsonOutput, commonOutput } =
          await executeParsedHook(hook, context, "UserPromptSubmit");

        if (hookResult.exitCode === 0 && jsonOutput) {
          const additionalContext = getStringField(
            commonOutput?.hookSpecificOutput?.additionalContext,
            jsonOutput.additionalContext,
          );

          result.additionalContext = appendAdditionalContext(
            result.additionalContext,
            additionalContext,
          );

          if (commonOutput?.systemMessage) {
            notify?.(commonOutput.systemMessage, "warning");
          }

          if (
            jsonOutput.decision !== undefined &&
            jsonOutput.decision !== "block"
          ) {
            notify?.(
              `UserPromptSubmit ignored an invalid decision: "${String(jsonOutput.decision)}"`,
              "warning",
            );
          }

          if (jsonOutput.decision === "block") {
            result.blocked = true;
            result.reason =
              getStringField(jsonOutput.reason) ?? "Blocked by a hook";
            return result;
          }
        } else if (hookResult.exitCode === 0 && plainStdout) {
          notify?.(`UserPromptSubmit hook output (not JSON): ${plainStdout}`, "info");
        }

        if (hookResult.exitCode !== 0) {
          notify?.(
            `UserPromptSubmit hook failed (exit ${hookResult.exitCode}): ${hookResult.stderr}`,
            "error",
          );
        }
      } catch (err) {
        notify?.(`UserPromptSubmit hook error: ${String(err)}`, "error");
      }
    }
  }

  return result;
}

export function registerPromptHooks(
  pi: ExtensionAPI,
  shared: HookModuleContext,
) {
  pi.on("input", async (event, ctx) => {
    shared.stopHookActive = false;

    const result = await triggerUserPromptSubmitHooks(
      {
        sessionId: shared.getSessionId(ctx),
        cwd: ctx.cwd,
        hookEventName: "UserPromptSubmit",
        transcriptPath: ctx.sessionManager.getSessionFile(),
        prompt: event.text,
      },
      shared.currentSettings,
      (msg, type) => shared.notify(ctx, msg, type),
    );

    if (result.blocked) {
      shared.notify(
        ctx,
        `UserPromptSubmit blocked: ${result.reason ?? "Blocked by a hook"}`,
        "warning",
      );
      return { action: "handled" } as const;
    }

    if (result.additionalContext) {
      // Contexts are consumed by before_agent_start in arrival order, so two
      // prompts queued before a run keep both instead of the last one winning.
      // The cap stops a context whose run never starts from piling up forever.
      shared.pendingUserPromptContexts.push(result.additionalContext);
      if (shared.pendingUserPromptContexts.length > 8) {
        shared.pendingUserPromptContexts.shift();
      }
    }

    return { action: "continue" } as const;
  });

  pi.on("before_agent_start", async (_event, _ctx) => {
    const additionalContext = shared.pendingUserPromptContexts.shift();
    if (!additionalContext) {
      return;
    }

    return {
      message: {
        customType: "pi-hooks",
        content: additionalContext,
        display: false,
        details: {
          hookEventName: "UserPromptSubmit",
        },
      },
    };
  });
}
