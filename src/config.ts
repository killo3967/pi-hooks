import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hook, HookEventName, HookGroup, HooksConfig, SettingsFile } from "./types.ts";

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

export type LoadSettingsOptions = {
  /**
   * Whether Pi granted project trust for `cwd`. `.pi/settings.json` is a
   * trust-protected resource: Pi will not load it before the user approves the
   * folder, because it can contain executable hooks. Reading it anyway would
   * turn `git clone` plus a session in that folder into arbitrary command
   * execution. Untrusted projects still get the global settings.
   */
  projectTrusted?: boolean;
  /** Test seam; defaults to the real global settings path. */
  globalSettingsPath?: string;
};

export function loadSettings(
  cwd: string,
  options: LoadSettingsOptions = {},
): {
  settings: SettingsFile | undefined;
  sourcePaths: string[];
} {
  const globalSettingsPath = options.globalSettingsPath ?? GLOBAL_SETTINGS_PATH;
  const projectSettingsPath = path.join(cwd, ".pi", "settings.json");
  const projectTrusted = options.projectTrusted === true;

  const globalSettings = readSettingsFile(globalSettingsPath);
  const projectSettings = projectTrusted
    ? readSettingsFile(projectSettingsPath)
    : undefined;

  const sourcePaths = [
    globalSettingsPath,
    ...(projectTrusted ? [projectSettingsPath] : []),
  ].filter((p) => existsSync(p));

  const hooks = mergeHooks(globalSettings?.hooks, projectSettings?.hooks);

  if (!hooks) {
    return { settings: undefined, sourcePaths };
  }

  return {
    settings: { hooks },
    sourcePaths,
  };
}

function sanitizeHook(value: unknown): Hook | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const hook = value as Record<string, unknown>;

  // Claude Code has other hook types (for example "prompt"); this extension only
  // runs command hooks, so anything else is skipped instead of executed.
  if (hook.type !== "command") return undefined;
  if (typeof hook.command !== "string" || !hook.command.trim()) return undefined;
  if (hook.if !== undefined && typeof hook.if !== "string") return undefined;
  if (
    hook.timeout !== undefined &&
    (typeof hook.timeout !== "number" || !Number.isFinite(hook.timeout) || hook.timeout <= 0)
  ) {
    return undefined;
  }

  return {
    type: "command",
    command: hook.command,
    ...(typeof hook.if === "string" ? { if: hook.if } : {}),
    ...(typeof hook.timeout === "number" ? { timeout: hook.timeout } : {}),
  };
}

function sanitizeGroup(value: unknown): HookGroup | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const group = value as Record<string, unknown>;
  if (group.matcher !== undefined && typeof group.matcher !== "string") return undefined;
  if (group.hooks !== undefined && !Array.isArray(group.hooks)) return undefined;

  const hooks = ((group.hooks as unknown[] | undefined) ?? []).flatMap((hook) => {
    const clean = sanitizeHook(hook);
    return clean ? [clean] : [];
  });

  return {
    ...(typeof group.matcher === "string" ? { matcher: group.matcher } : {}),
    hooks,
  };
}

/**
 * Malformed entries are dropped instead of thrown at. A single null group used
 * to raise a TypeError inside a tool_call handler, and Pi answers a failing
 * tool_call handler by blocking the tool: one typo in settings.json disabled
 * every tool call in the session.
 */
function sanitizeGroups(values: unknown[]): HookGroup[] {
  return values.flatMap((value) => {
    const clean = sanitizeGroup(value);
    return clean ? [clean] : [];
  });
}

export function getHookGroups(
  settings: SettingsFile | undefined,
  eventName: HookEventName,
): HookGroup[] {
  const hooks = settings?.hooks;
  if (!hooks) return [];

  let groups: unknown[];
  switch (eventName) {
    case "SessionStart":
      groups = [...(hooks.SessionStart ?? []), ...(hooks.session_start ?? [])];
      break;
    case "SessionEnd":
      groups = [...(hooks.SessionEnd ?? []), ...(hooks.session_end ?? [])];
      break;
    case "PreCompact":
      groups = [...(hooks.PreCompact ?? []), ...(hooks.pre_compact ?? [])];
      break;
    case "PostCompact":
      groups = [...(hooks.PostCompact ?? []), ...(hooks.post_compact ?? [])];
      break;
    case "PreToolUse":
      groups = [...(hooks.PreToolUse ?? []), ...(hooks.pre_tool_use ?? [])];
      break;
    case "PostToolUse":
      groups = [...(hooks.PostToolUse ?? []), ...(hooks.post_tool_use ?? [])];
      break;
    case "PostToolUseFailure":
      groups = [...(hooks.PostToolUseFailure ?? []), ...(hooks.post_tool_use_failure ?? [])];
      break;
    case "UserPromptSubmit":
      groups = [...(hooks.UserPromptSubmit ?? []), ...(hooks.user_prompt_submit ?? [])];
      break;
    case "Stop":
      groups = [...(hooks.Stop ?? []), ...(hooks.stop ?? [])];
      break;
    default:
      groups = [];
  }

  return sanitizeGroups(groups);
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
