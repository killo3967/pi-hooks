import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HookEventName, HookGroup, HooksConfig, SettingsFile } from "./types.ts";

// ============================================================================
// Settings loading
// ============================================================================

export const GLOBAL_SETTINGS_PATH = path.join(
  os.homedir(),
  ".pi",
  "agent",
  "settings.json",
);

const HOOK_KEYS: Array<keyof HooksConfig> = [
  "SessionStart",
  "SessionEnd",
  "PreCompact",
  "PostCompact",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "UserPromptSubmit",
  "Stop",
  "session_start",
  "session_end",
  "pre_compact",
  "post_compact",
  "pre_tool_use",
  "post_tool_use",
  "post_tool_use_failure",
  "user_prompt_submit",
  "stop",
];

export function readSettingsFile(settingsPath: string): SettingsFile | undefined {
  if (!existsSync(settingsPath)) {
    return undefined;
  }

  try {
    const raw = readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    // A settings file with the wrong shape is a broken configuration, not a
    // valid one with missing keys: treat it as absent so the hook layer falls
    // back instead of silently ignoring half a file.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }

    const candidate = parsed as Record<string, unknown>;
    const hooks = candidate.hooks;
    if (hooks !== undefined && (typeof hooks !== "object" || hooks === null || Array.isArray(hooks))) {
      return undefined;
    }
    if (candidate.shellPath !== undefined && typeof candidate.shellPath !== "string") {
      return undefined;
    }

    return parsed as SettingsFile;
  } catch {
    return undefined;
  }
}

export function mergeHooks(
  globalHooks: HooksConfig | undefined,
  projectHooks: HooksConfig | undefined,
): HooksConfig | undefined {
  const merged: HooksConfig = {};
  let hasAnyHook = false;

  for (const key of HOOK_KEYS) {
    const groups = [
      ...(globalHooks?.[key] ?? []),
      ...(projectHooks?.[key] ?? []),
    ];

    if (groups.length > 0) {
      merged[key] = groups;
      hasAnyHook = true;
    }
  }

  return hasAnyHook ? merged : undefined;
}

export function loadSettings(cwd: string): {
  settings: SettingsFile | undefined;
  sourcePaths: string[];
} {
  const projectSettingsPath = path.join(cwd, ".pi", "settings.json");
  const globalSettings = readSettingsFile(GLOBAL_SETTINGS_PATH);
  const projectSettings = readSettingsFile(projectSettingsPath);

  const sourcePaths = [GLOBAL_SETTINGS_PATH, projectSettingsPath].filter((p) =>
    existsSync(p),
  );

  const hooks = mergeHooks(globalSettings?.hooks, projectSettings?.hooks);

  if (!hooks) {
    return { settings: undefined, sourcePaths };
  }

  return {
    settings: { hooks },
    sourcePaths,
  };
}

export function getHookGroups(
  settings: SettingsFile | undefined,
  eventName: HookEventName,
): HookGroup[] {
  const hooks = settings?.hooks;
  if (!hooks) return [];

  switch (eventName) {
    case "SessionStart":
      return [...(hooks.SessionStart ?? []), ...(hooks.session_start ?? [])];
    case "SessionEnd":
      return [...(hooks.SessionEnd ?? []), ...(hooks.session_end ?? [])];
    case "PreCompact":
      return [...(hooks.PreCompact ?? []), ...(hooks.pre_compact ?? [])];
    case "PostCompact":
      return [...(hooks.PostCompact ?? []), ...(hooks.post_compact ?? [])];
    case "PreToolUse":
      return [...(hooks.PreToolUse ?? []), ...(hooks.pre_tool_use ?? [])];
    case "PostToolUse":
      return [...(hooks.PostToolUse ?? []), ...(hooks.post_tool_use ?? [])];
    case "PostToolUseFailure":
      return [
        ...(hooks.PostToolUseFailure ?? []),
        ...(hooks.post_tool_use_failure ?? []),
      ];
    case "UserPromptSubmit":
      return [
        ...(hooks.UserPromptSubmit ?? []),
        ...(hooks.user_prompt_submit ?? []),
      ];
    case "Stop":
      return [...(hooks.Stop ?? []), ...(hooks.stop ?? [])];
    default:
      return [];
  }
}

/**
 * Checks whether a matcher matches the given value.
 *
 * Matches Claude Code: the matcher is a single regex string.
 * `undefined`, `""` and `"*"` all mean "match everything".
 */
export function matcherMatches(
  matcher: string | undefined,
  value: string,
): boolean {
  if (!matcher || matcher === "" || matcher === "*") return true;

  try {
    const regex = new RegExp(matcher);
    return regex.test(value);
  } catch {
    return matcher === value;
  }
}
