import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describeInjectedContext } from "../helpers.ts";
import type { HookModuleContext } from "../hook-context.ts";
import type {
  HookExecutionContext,
  NotifyFn,
  SettingsFile,
  UserPromptSubmitResult,
} from "../types.ts";
import { appendAdditionalContext, getStringField, runHookGroups } from "./shared.ts";
import type { HookRunner } from "./shared.ts";

export async function triggerUserPromptSubmitHooks(
  context: HookExecutionContext,
  settings: SettingsFile | undefined,
  notify?: NotifyFn,
  runner?: HookRunner,
): Promise<UserPromptSubmitResult> {
  const result: UserPromptSubmitResult = { blocked: false };

  await runHookGroups({
    eventName: "UserPromptSubmit",
    context,
    settings,
    notify,
    runner,
    onOutcome: ({ hookResult, plainStdout, jsonOutput, commonOutput }) => {
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

        if (jsonOutput.decision !== undefined && jsonOutput.decision !== "block") {
          notify?.(
            `UserPromptSubmit ignored an invalid decision: "${String(jsonOutput.decision)}"`,
            "warning",
          );
        }

        if (jsonOutput.decision === "block") {
          result.blocked = true;
          result.reason = getStringField(jsonOutput.reason) ?? "Blocked by a hook";
          return "stop";
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

      return undefined;
    },
  });

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

  pi.on("before_agent_start", async (_event, ctx) => {
    const additionalContext = shared.pendingUserPromptContexts.shift();
    if (!additionalContext) {
      return;
    }

    // The context itself stays hidden, but the injection is announced: the
    // model is steered by it, so the injection cannot be invisible.
    shared.notify(ctx, describeInjectedContext("UserPromptSubmit", additionalContext), "info");

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
