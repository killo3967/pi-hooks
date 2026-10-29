# Troubleshooting

> Part of the [pi-hooks documentation](../README.md). Work out why a hook did not fire or did not block.


Hooks are **fail-open**: when a hook cannot run, or returns something that is not a usable decision,
the tool call proceeds and a notification records what happened. That is deliberate — a broken hook
must not wedge your editor — but it means "my hook didn't block" is usually "my hook didn't run".

Check these in order:

1. **Did the command run at all?** A hook that cannot start (missing binary, unexpected shell)
   notifies `PreToolUse hook failed (exit N)` or `<Event> hook error`. Test the command outside Pi first:

   ```bash
   echo '{"hook_event_name":"PreToolUse","tool_name":"bash","tool_input":{"command":"git add x"}}' | <your command>
   ```

   It has to print one JSON object and exit 0.

2. **Is the output valid JSON?** Exiting 0 while printing anything else counts as "no decision" and
   the tool runs; that case notifies `PreToolUse hook output (not JSON): …`.

3. **Does the hook apply at all?** `matcher` is a regex over the tool name and `if` filters per hook.
   If either does not match, the hook is skipped before anything runs.

4. **On Windows** the command runs through the shell resolved at startup: `shellPath` from
   `~/.pi/agent/settings.json`, then a known Git Bash/MSYS2 install, then `COMSPEC` (`cmd.exe`).
   A bare `bash` on PATH is deliberately not used, because it is usually the WSL launcher, which
   cannot see your Node.js installation or Windows paths. If your command needs bash features, point
   `shellPath` at Git Bash; otherwise write it to work under `cmd.exe` too.
