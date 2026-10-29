# Local development

> Part of the [pi-hooks documentation](../README.md). Run the extension from a checkout and run its checks.


```bash
pi
```

Then run:

```text
/pi-hooks
/pi-hooks-reset
```

## Tests and checks


```bash
pnpm install
pnpm run typecheck   # tsc --noEmit over src/ and test/
pnpm test            # node --test, no build step
```

Tests run against the TypeScript sources directly through Node's native type
stripping (Node 24+), so there is no build step, no test framework dependency
and no compiled output. Hook execution is exercised for real: a test writes a
throwaway script and runs it through the same shell resolution the extension
uses, which means the Windows `cmd.exe` fallback path is covered on Windows
runners and the POSIX `bash -c` path on Linux ones.

## End-to-end tests

The unit tests fake the extension API, so they never prove that Pi loads
`pi-hooks` and that a decision reaches it. The end-to-end tests do: they start a
real Pi against a stub model, with a throwaway agent directory and project, and
assert on the payloads the hooks recorded.

```bash
pnpm test:e2e        # needs a local Pi; skips itself when there is none
node test/e2e/spike.ts   # wire-format probe, useful when Pi changes provider APIs
```

They live in `test/e2e/` and are named `*.e2e.ts`, so `pnpm test` does not run
them. If Pi is not installed, each scenario reports itself as skipped instead of
failing.
