# pi-hooks documentation

Four sections, organised by what you are trying to do. Start with the tutorial if the extension is new to
you; jump to reference when you need an exact field.

| Section | Start here when… |
|---|---|
| **[Tutorial](tutorials/first-hook.md)** | You have never configured a hook and want one working end to end |
| **[How-to guides](how-to/install.md)** | You know what you want: install, develop, release, troubleshoot |
| **[Reference](reference/configuration.md)** | You need the exact settings shape, matcher rule, or payload field |
| **[Explanation](explanation/how-it-works.md)** | You want to understand the mapping, the design or the security posture |

## Tutorial

- [Your first hook](tutorials/first-hook.md) — install, fire a `SessionStart` hook, block a tool call.

## How-to guides

- [Install and configure](how-to/install.md) — add the extension and a first hook group.
- [Develop and run the checks](how-to/develop.md) — run it from a checkout, typecheck and test it.
- [Release a version](how-to/release.md) — tag, and let CI publish with OIDC.
- [Troubleshoot a hook that did not fire](how-to/troubleshoot.md) — the fail-open checklist.

## Reference

- [Configuration](reference/configuration.md) — settings files, merge order, source layout.
- [Matchers and conditions](reference/matchers.md) — the `matcher` regex and the per-hook `if`.
- [Hook input](reference/hook-input.md) — the JSON each event receives on stdin.
- [Hook output](reference/hook-output.md) — the JSON each event may print, and what Pi does with it.

## Explanation

- [How it works](explanation/how-it-works.md) — Pi events mapped to Claude Code hooks, plus design notes.
- [Security](explanation/security.md) — what hooks can run, what they see, and why the extension is fail-open.
