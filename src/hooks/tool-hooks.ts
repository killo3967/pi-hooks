import type {
  ExtensionAPI,
  ExtensionContext,
  ToolResultEventResult,
} from "@earendil-works/pi-coding-agent";
import { extractErrorFromContent } from "../helpers.ts";
import type { HookModuleContext } from "../hook-context.ts";
import type {
  HookExecutionContext,
  NotifyFn,
  PostToolUseResult,
  PreToolUseResult,
  SettingsFile,
} from "../types.ts";
import {
  appendAdditionalContext,
  extractToolResultPatch,
  getStringField,
  runHookGroups,
} from "./shared.ts";

export async function triggerPreToolUseHooks(
  toolName: string,
  context: HookExecutionContext,
  settings: SettingsFile | undefined,
  notify?: NotifyFn,
): Promise<PreToolUseResult> {
  const result: PreToolUseResult = { blocked: false };

  await runHookGroups({
    eventName: "PreToolUse",
    matcherValue: toolName,
    context,
    settings,
    notify,
    onOutcome: ({ hookResult, plainStdout, jsonOutput, commonOutput }) => {
      if (hookResult.exitCode === 2) {
        result.blocked = true;
        result.reason = hookResult.stderr || "Blocked by a hook";
        notify?.(`PreToolUse blocked (exit 2): ${result.reason}`, "warning");
        return "stop";
      }

      if (hookResult.exitCode === 0 && jsonOutput) {
        const hookSpecific = commonOutput?.hookSpecificOutput;

        if (commonOutput?.stopProcessing) {
          result.stopProcessing = true;
          result.stopReason = commonOutput.stopReason;
          return "stop";
        }

        const decision = (hookSpecific?.permissionDecision ??
          jsonOutput.permissionDecision) as "allow" | "deny" | undefined;

        if (decision === "deny") {
          result.blocked = true;
          // A hook can put anything here; only a non-empty string is a reason
          // worth showing, and an object would render as [object Object].
          result.reason = getStringField(
            hookSpecific?.permissionDecisionReason,
            jsonOutput.permissionDecisionReason,
          );
          result.reason ??= "Blocked by a hook";
          notify?.(`PreToolUse denied by hook: ${result.reason}`, "warning");
          return "stop";
        }

        const updatedInput = hookSpecific?.updatedInput ?? jsonOutput.updatedInput;
        if (updatedInput && typeof updatedInput === "object") {
          result.updatedInput = updatedInput as Record<string, unknown>;
        }

        result.additionalContext = appendAdditionalContext(
          result.additionalContext,
          getStringField(hookSpecific?.additionalContext, jsonOutput.additionalContext),
        );
      } else if (hookResult.exitCode === 0 && plainStdout) {
        notify?.(`PreToolUse hook output (not JSON): ${plainStdout}`, "info");
      }

      if (hookResult.exitCode !== 0 && hookResult.exitCode !== 2) {
        notify?.(
          `PreToolUse hook failed (exit ${hookResult.exitCode}): ${hookResult.stderr}`,
          "error",
        );
      }

      return undefined;
    },
  });

  return result;
}

/**
 * PostToolUse and PostToolUseFailure differ only in the event name they report
 * and tag their patches with; the decision logic is identical.
 */
async function triggerPostToolHooks(
  eventName: "PostToolUse" | "PostToolUseFailure",
  toolName: string,
  context: HookExecutionContext,
  settings: SettingsFile | undefined,
  notify?: NotifyFn,
): Promise<PostToolUseResult> {
  const result: PostToolUseResult = {};

  await runHookGroups({
    eventName,
    matcherValue: toolName,
    context,
    settings,
    notify,
    onOutcome: ({ hookResult, plainStdout, jsonOutput, commonOutput }) => {
      if (hookResult.exitCode === 2) {
        notify?.(`${eventName} feedback (exit 2): ${hookResult.stderr}`, "warning");
        return undefined;
      }

      if (hookResult.exitCode === 0 && jsonOutput) {
        const hookSpecific = commonOutput?.hookSpecificOutput;

        if (commonOutput?.stopProcessing) {
          result.stopProcessing = true;
          result.stopReason = commonOutput.stopReason;
        }

        result.additionalContext = appendAdditionalContext(
          result.additionalContext,
          getStringField(
            hookSpecific?.additionalContext,
            jsonOutput.additionalContext,
            jsonOutput.decision === "block" ? jsonOutput.reason : undefined,
          ),
        );

        const patch = extractToolResultPatch(eventName, jsonOutput);
        if (patch.content !== undefined) result.content = patch.content;
        if (patch.details !== undefined) result.details = patch.details;
        if (patch.isError !== undefined) result.isError = patch.isError;
      } else if (hookResult.exitCode === 0 && plainStdout) {
        notify?.(`${eventName} hook output: ${plainStdout}`, "info");
      }

      if (hookResult.exitCode !== 0 && hookResult.exitCode !== 2) {
        notify?.(
          `${eventName} hook failed (exit ${hookResult.exitCode}): ${hookResult.stderr}`,
          "error",
        );
      }

      return undefined;
    },
  });

  return result;
}

export function triggerPostToolUseHooks(
  toolName: string,
  context: HookExecutionContext,
  settings: SettingsFile | undefined,
  notify?: NotifyFn,
): Promise<PostToolUseResult> {
  return triggerPostToolHooks("PostToolUse", toolName, context, settings, notify);
}

export function triggerPostToolUseFailureHooks(
  toolName: string,
  context: HookExecutionContext,
  settings: SettingsFile | undefined,
  notify?: NotifyFn,
): Promise<PostToolUseResult> {
  return triggerPostToolHooks("PostToolUseFailure", toolName, context, settings, notify);
}

/**
 * Turns a hook patch into the result shape Pi expects. A hook can return any
 * JSON, but the contract for content is an array of text/image parts, so
 * anything else falls back to the original content instead of being forwarded:
 * the previous cast hid that mismatch from the compiler.
 */
function toToolResultPatch(
  result: PostToolUseResult,
  event: { content: unknown; details?: unknown; isError: boolean },
): ToolResultEventResult {
  return {
    content: Array.isArray(result.content)
      ? (result.content as ToolResultEventResult["content"])
      : (event.content as ToolResultEventResult["content"]),
    details: result.details ?? event.details,
    isError: result.isError ?? event.isError,
  };
}

export function registerToolHooks(pi: ExtensionAPI, shared: HookModuleContext) {
  pi.on("tool_call", async (event, ctx) => {
    const result = await triggerPreToolUseHooks(
      event.toolName,
      {
        sessionId: shared.getSessionId(ctx),
        cwd: ctx.cwd,
        hookEventName: "PreToolUse",
        transcriptPath: ctx.sessionManager.getSessionFile(),
        toolName: event.toolName,
        toolInput: event.input as Record<string, unknown>,
        toolUseId: event.toolCallId,
      },
      shared.currentSettings,
      (msg, type) => shared.notify(ctx, msg, type),
    );

    if (result.updatedInput) {
      Object.assign(event.input, result.updatedInput);
    }

    if (result.stopProcessing) {
      const stopReason = result.stopReason ?? "Stopped by a hook";
      ctx.abort?.();
      return { block: true, reason: stopReason };
    }

    if (result.blocked) {
      return { block: true, reason: result.reason };
    }

    if (result.additionalContext) {
      shared.injectHiddenContext(result.additionalContext, {
        hookEventName: "PreToolUse",
        toolName: event.toolName,
        toolUseId: event.toolCallId,
      });
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.isError) {
      const result = await triggerPostToolUseFailureHooks(
        event.toolName,
        {
          sessionId: shared.getSessionId(ctx),
          cwd: ctx.cwd,
          hookEventName: "PostToolUseFailure",
          transcriptPath: ctx.sessionManager.getSessionFile(),
          toolName: event.toolName,
          toolInput: event.input as Record<string, unknown>,
          toolUseId: event.toolCallId,
          error: extractErrorFromContent(event.content),
          isInterrupt: false,
        },
        shared.currentSettings,
        (msg, type) => shared.notify(ctx, msg, type),
      );

      if (result.additionalContext) {
        shared.injectHiddenContext(result.additionalContext, {
          hookEventName: "PostToolUseFailure",
          toolName: event.toolName,
          toolUseId: event.toolCallId,
        });
      }

      if (result.stopProcessing) {
        ctx.abort?.();
      }

      if (
        result.content !== undefined ||
        result.details !== undefined ||
        result.isError !== undefined
      ) {
        return toToolResultPatch(result, event);
      }

      return;
    }

    const result = await triggerPostToolUseHooks(
      event.toolName,
      {
        sessionId: shared.getSessionId(ctx),
        cwd: ctx.cwd,
        hookEventName: "PostToolUse",
        transcriptPath: ctx.sessionManager.getSessionFile(),
        toolName: event.toolName,
        toolInput: event.input as Record<string, unknown>,
        toolUseId: event.toolCallId,
        toolResponse: shared.buildToolResponse(event),
      },
      shared.currentSettings,
      (msg, type) => shared.notify(ctx, msg, type),
    );

    if (result.additionalContext) {
      shared.injectHiddenContext(result.additionalContext, {
        hookEventName: "PostToolUse",
        toolName: event.toolName,
        toolUseId: event.toolCallId,
      });
    }

    if (result.stopProcessing) {
      ctx.abort?.();
    }

    if (
      result.content !== undefined ||
      result.details !== undefined ||
      result.isError !== undefined
    ) {
      return toToolResultPatch(result, event);
    }
  });
}
