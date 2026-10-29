import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const scriptPath = path.resolve("scripts/check-release-tag.sh");

type Repo = {
  dir: string;
  commit: (message: string) => string;
  checkout: (branch: string, create?: boolean) => void;
  merge: (branch: string) => void;
  check: (sha: string, ref?: string) => { code: number; stderr: string };
  cleanup: () => void;
};

/**
 * A throwaway repository:
 *
 *   A --- C        main
 *    \
 *     B            feature (unmerged)
 */
function repo(): Repo {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pi-hooks-tag-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();

  git("init", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");

  return {
    dir,
    commit: (message) => {
      execFileSync("git", ["commit", "--allow-empty", "-m", message], {
        cwd: dir,
        encoding: "utf8",
      });
      return git("rev-parse", "HEAD");
    },
    checkout: (branch, create = false) => git("checkout", ...(create ? ["-b"] : []), branch),
    merge: (branch) => git("merge", "--no-ff", "-m", `merge ${branch}`, branch),
    check: (sha, ref = "main") => {
      try {
        execFileSync("bash", [scriptPath, sha, ref], { cwd: dir, encoding: "utf8" });
        return { code: 0, stderr: "" };
      } catch (err) {
        const error = err as { status?: number; stderr?: string };
        return { code: error.status ?? 1, stderr: String(error.stderr ?? "") };
      }
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  };
}

test("accepts a commit that is the head of the release branch", () => {
  const r = repo();
  try {
    const head = r.commit("A");
    assert.equal(r.check(head).code, 0);
  } finally {
    r.cleanup();
  }
});

test("accepts a commit that is an ancestor of the release branch", () => {
  const r = repo();
  try {
    const first = r.commit("A");
    r.commit("C");
    assert.equal(r.check(first).code, 0);
  } finally {
    r.cleanup();
  }
});

test("rejects a commit from an unmerged branch", () => {
  const r = repo();
  try {
    r.commit("A");
    r.checkout("feature", true);
    const featureHead = r.commit("B");
    r.checkout("main");

    const result = r.check(featureHead);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /not on main/);
  } finally {
    r.cleanup();
  }
});

test("accepts a commit that reached main through a merge", () => {
  const r = repo();
  try {
    r.commit("A");
    r.checkout("feature", true);
    const featureHead = r.commit("B");
    r.checkout("main");
    r.commit("C");
    r.merge("feature");

    assert.equal(r.check(featureHead).code, 0);
  } finally {
    r.cleanup();
  }
});

test("fails loudly when the ref does not exist", () => {
  const r = repo();
  try {
    const head = r.commit("A");
    const result = r.check(head, "no-such-branch");

    assert.equal(result.code, 1);
    assert.match(result.stderr, /no-such-branch/);
  } finally {
    r.cleanup();
  }
});
