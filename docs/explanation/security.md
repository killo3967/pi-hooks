# Security

> Part of the [pi-hooks documentation](../README.md). What hooks can do, what they see, and the fail-open posture.


Hooks run commands through your shell with the permissions of the Pi process. Treat a hook config
like any other script you run on your machine.

- **Project settings need project trust.** `.pi/settings.json` is a resource Pi withholds until you
  approve the folder, because it can carry executable hooks. `pi-hooks` asks Pi for that decision
  (`ctx.isProjectTrusted()`) before reading project hooks, so cloning a repository and opening a
  session in it cannot run its hooks until you trust it. Global settings are always read.
- **Injected context comes from your hooks.** `additionalContext` and `SessionStart` stdout are added
  to the conversation as hidden messages: the model sees them, the terminal does not.
- **Hooks see the payload.** Every configured hook receives the prompt, the tool inputs and the tool
  results, which can contain file contents and secrets. Only configure hooks you trust.
- **Hook output is not persisted.** Notifications carry a hook's stdout/stderr to the UI but are not
  written to the session transcript.
- **There is no fail-closed mode.** When a hook cannot run — timeout, missing binary, broken shell —
  the action proceeds and the failure is only reported. That is deliberate, and `pi-hooks` does not
  expose a switch to turn a broken guardrail into a denial. Use a hook that always returns a decision
  if you need one, not one whose absence blocks you.
