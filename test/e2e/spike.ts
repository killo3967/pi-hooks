import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPlayground } from "./support/playground.ts";
import { startStubModel } from "./stub-model.ts";

/**
 * Wire-format probe.
 *
 * Starts the stub model, points a real Pi at it and reports what happened. Use
 * it when Pi changes the API it speaks: if this prints OK, the stub is still a
 * valid model and the e2e scenarios can trust it. It is not part of `pnpm test`.
 *
 * Run: node test/e2e/spike.ts
 */

const launcher =
  process.env.PI_LAUNCHER ??
  path.join(os.homedir(), ".pi", "agent", "bin", "pi-launcher.js");
const extension = path.resolve("src/pi-hooks.ts");

if (!existsSync(launcher)) {
  console.error(`No Pi launcher at ${launcher}. Set PI_LAUNCHER.`);
  process.exit(2);
}

const stub = await startStubModel([{ text: "OK" }]);
const port = Number(new URL(stub.url).port);
const playground = createPlayground({ modelPort: port });

const run = () =>
  new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(
      process.execPath,
      [
        launcher,
        "--mode",
        "json",
        "-p",
        "--no-extensions",
        "-e",
        extension,
        "--model",
        "stub/stub-model",
        "Responde solo: OK",
      ],
      {
        cwd: playground.projectDir,
        // Pi reads stdin when it is a pipe and then waits for EOF, which never
        // arrives from a spawned child: give it nothing instead.
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PI_CODING_AGENT_DIR: playground.agentDir,
          PI_OFFLINE: "1",
        },
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (piece) => {
      stdout += piece;
    });
    child.stderr.on("data", (piece) => {
      stderr += piece;
    });

    const timer = setTimeout(() => child.kill(), 30_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });

const result = await run();
await stub.close();
playground.cleanup();

console.log("exit:", result.code);
console.log("peticiones al doble:", stub.requests.length);
console.log("modelo pedido:", stub.requests[0]?.body?.model ?? "(ninguno)");
console.log("respuesta contiene OK:", result.stdout.includes("OK"));
console.log("--- stdout (últimas 6 líneas) ---");
console.log(result.stdout.trim().split("\n").slice(-6).join("\n"));
console.log("--- stderr (últimas 6 líneas) ---");
console.log(result.stderr.trim().split("\n").slice(-6).join("\n"));
