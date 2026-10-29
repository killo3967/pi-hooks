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
