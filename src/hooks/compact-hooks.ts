import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { HookModuleContext } from "../hook-context.ts";
import type {
  HookExecutionContext,
  HookRunResult,
  NotifyFn,
  SettingsFile,
} from "../types.ts";
import { triggerSimpleHooks } from "./shared.ts";

type CompactReason = "manual" | "threshold" | "overflow";

/**
 * `reason` was added to the compaction events after 0.74.0, which is the
 * version this package's peer types resolve to. Read it defensively so the
 * extension works on both: no reason means the historical manual behaviour.
 */
function readCompactReason(event: unknown): CompactReason | undefined {
  const reason = (event as { reason?: unknown }).reason;
  return reason === "manual" || reason === "threshold" || reason === "overflow"
    ? reason
    : undefined;
}

/**
 * Pi reports three compaction reasons; the Claude Code hook contract only knows
 * `manual` and `auto`. `threshold` (context pressure) and `overflow` (the
 * request did not fit) are both automatic, so they collapse to `auto`.
 */
export function toCompactTrigger(reason: CompactReason | undefined): "manual" | "auto" {
  return reason === "threshold" || reason === "overflow" ? "auto" : "manual";
}

async function triggerCompactHooks(
  eventName: "PreCompact" | "PostCompact",
  context: HookExecutionContext,
  settings: SettingsFile | undefined,
  notify?: NotifyFn,
): Promise<HookRunResult> {
  return triggerSimpleHooks(eventName, context.trigger ?? "manual", context, settings, notify);
}

export function registerCompactHooks(pi: ExtensionAPI, shared: HookModuleContext) {
  pi.on("session_before_compact", async (event, ctx) => {
    await triggerCompactHooks(
      "PreCompact",
      {
        sessionId: shared.getSessionId(ctx),
        cwd: ctx.cwd,
        hookEventName: "PreCompact",
        trigger: toCompactTrigger(readCompactReason(event)),
        customInstructions: event.customInstructions ?? "",
        transcriptPath: ctx.sessionManager.getSessionFile(),
      },
      shared.currentSettings,
      (msg, type) => shared.notify(ctx, msg, type),
    );
  });

  pi.on("session_compact", async (event, ctx) => {
    await triggerCompactHooks(
      "PostCompact",
      {
        sessionId: shared.getSessionId(ctx),
        cwd: ctx.cwd,
        hookEventName: "PostCompact",
        trigger: toCompactTrigger(readCompactReason(event)),
        compactSummary: event.compactionEntry.summary,
        transcriptPath: ctx.sessionManager.getSessionFile(),
      },
      shared.currentSettings,
      (msg, type) => shared.notify(ctx, msg, type),
    );

    await shared.triggerSessionStartHook("compact", ctx);
  });
}
