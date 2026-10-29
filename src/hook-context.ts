import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadSettings } from "./config.ts";
import { extractResponseFromContent } from "./helpers.ts";
import { triggerSessionHooks } from "./hooks/session-hooks.ts";
import type { HookMatcherValue, SettingsFile } from "./types.ts";

export type NotifyType = "info" | "error" | "warning";

export type HookModuleContext = {
  pi: ExtensionAPI;
  currentSettings: SettingsFile | undefined;
  firedSessionStartKeys: Set<string>;
  /** Contexts waiting to be attached to the next runs, in arrival order. */
  pendingUserPromptContexts: string[];
  stopHookActive: boolean;
  getSessionId: (ctx: any) => string;
  notify: (ctx: any, msg: string, type: NotifyType) => void;
  injectHiddenContext: (
    content: string,
    details: Record<string, unknown>,
  ) => void;
  initSettings: (cwd: string, projectTrusted: boolean) => SettingsFile | undefined;
  buildToolResponse: (event: {
    content: unknown;
    details?: unknown;
    isError?: boolean;
  }) => Record<string, unknown>;
  triggerSessionStartHook: (
    matcher: HookMatcherValue<"SessionStart">,
    ctx: any,
  ) => Promise<void>;
};

export function createHookContext(pi: ExtensionAPI): HookModuleContext {
  const shared: HookModuleContext = {
    pi,
    currentSettings: undefined,
    firedSessionStartKeys: new Set<string>(),
    pendingUserPromptContexts: [],
    stopHookActive: false,
    getSessionId: (ctx: any) =>
      ctx.sessionManager.getSessionFile() ?? "ephemeral",
    notify: (ctx: any, msg: string, type: NotifyType) =>
      ctx.ui.notify(msg, type),
    // Known limitation: this uses the `pi` captured when the extension loaded.
    // Pi invalidates a captured `pi` after a session replacement (newSession,
    // fork, switchSession, reload), which is what PR #2 upstream tried to paper
    // over with a blanket try/catch. Reproducing that on pi 1.4 needed a host
    // driven replacement and did not reproduce through `-p`, so there is no
    // evidence to justify swallowing errors here; if it ever shows up, pass the
    // fresh event `ctx` instead of guarding with a silent catch.
    injectHiddenContext: (content, details) => {
      shared.pi.sendMessage({
        customType: "pi-hooks",
        content,
        display: false,
        details,
      });
    },
    initSettings: (cwd, projectTrusted) => {
      const { settings } = loadSettings(cwd, { projectTrusted });
      shared.currentSettings = settings;
      return settings;
    },
    buildToolResponse: (event) => {
      const toolResponse: Record<string, unknown> = {
        content: event.content,
        is_error: event.isError ?? false,
      };

      if (event.details !== undefined) {
        toolResponse.details = event.details;
      }

      const extracted = extractResponseFromContent(event.content);
      if (Object.keys(extracted).length > 0) {
        toolResponse.output = extracted.output ?? extracted;
      }

      return toolResponse;
    },
    triggerSessionStartHook: async (matcher, ctx) => {
      const sessionId = shared.getSessionId(ctx);

      // `startup` can arrive twice for the same session (Pi emits `startup` and
      // then `new`) and `resume` is re-emitted on some flows, so both are
      // deduped per session. `compact` is different: it fires once per
      // compaction and a long session compacts many times, so deduping it made
      // the hook run only the first time.
      if (matcher !== "compact") {
        const dedupeKey = `${matcher}:${sessionId}`;
        if (shared.firedSessionStartKeys.has(dedupeKey)) {
          return;
        }
        shared.firedSessionStartKeys.add(dedupeKey);
      }

      const result = await triggerSessionHooks(
        "SessionStart",
        matcher,
        {
          sessionId,
          cwd: ctx.cwd,
          hookEventName: "SessionStart",
          source: matcher,
        },
        shared.currentSettings,
        (msg, type) => shared.notify(ctx, msg, type),
      );

      if (result.additionalContext) {
        shared.injectHiddenContext(result.additionalContext, {
          hookEventName: "SessionStart",
          source: matcher,
        });
      }
    },
  };

  return shared;
}
