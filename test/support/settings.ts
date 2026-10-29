import type {
  Hook,
  HooksConfig,
  NotifyFn,
  SettingsFile,
} from "../../src/types.ts";

/** Builds settings with a single hook group for one event. */
export function settingsWith(
  event: keyof HooksConfig,
  hook: Hook,
  matcher?: string,
): SettingsFile {
  return { hooks: { [event]: [{ matcher, hooks: [hook] }] } };
}

/** A `NotifyFn` that records every message with its level. */
export function recorder(): {
  notify: NotifyFn;
  messages: Array<[message: string, type: string]>;
} {
  const messages: Array<[string, string]> = [];
  return {
    messages,
    notify: (message, type) => {
      messages.push([message, type]);
    },
  };
}
