import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type Playground = {
  /** Directory passed as PI_CODING_AGENT_DIR: holds models.json. */
  agentDir: string;
  /** Working directory for the run: holds .pi/settings.json. */
  projectDir: string;
  cleanup: () => void;
};

/**
 * Builds a throwaway Pi "installation": a private agent directory pointing at
 * the stub model, and a project with the hooks under test. Nothing touches the
 * real ~/.pi/agent, so a run cannot depend on the developer's own settings.
 */
export function createPlayground(options: {
  modelPort: number;
  hooks?: object;
  /** Extra files, relative to the project directory. */
  files?: Record<string, string>;
}): Playground {
  const root = mkdtempSync(path.join(os.tmpdir(), "pi-hooks-e2e-"));
  const agentDir = path.join(root, "agent");
  const projectDir = path.join(root, "project");

  mkdirSync(agentDir, { recursive: true });
  mkdirSync(path.join(projectDir, ".pi"), { recursive: true });

  writeFileSync(
    path.join(agentDir, "models.json"),
    JSON.stringify(
      {
        providers: {
          stub: {
            baseUrl: `http://127.0.0.1:${options.modelPort}/v1`,
            api: "openai-completions",
            apiKey: "stub",
            models: [{ id: "stub-model" }],
          },
        },
      },
      null,
      2,
    ),
  );

  if (options.hooks) {
    writeFileSync(
      path.join(projectDir, ".pi", "settings.json"),
      JSON.stringify({ hooks: options.hooks }, null, 2),
    );
  }

  for (const [relative, content] of Object.entries(options.files ?? {})) {
    const target = path.join(projectDir, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }

  return {
    agentDir,
    projectDir,
    cleanup: () =>
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  };
}
