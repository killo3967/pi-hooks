import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createHookContext } from "./hook-context.ts";
import { registerCompactHooks } from "./hooks/compact-hooks.ts";
import { registerPromptHooks } from "./hooks/prompt-hooks.ts";
import { registerSessionHooks } from "./hooks/session-hooks.ts";
import { registerStopHooks } from "./hooks/stop-hooks.ts";
import { registerToolHooks } from "./hooks/tool-hooks.ts";

// ============================================================================
// Extension entry point
// ============================================================================

export default function (pi: ExtensionAPI) {
  const shared = createHookContext(pi);

  registerSessionHooks(pi, shared);
  registerCompactHooks(pi, shared);
  registerPromptHooks(pi, shared);
  registerStopHooks(pi, shared);
  registerToolHooks(pi, shared);
}
