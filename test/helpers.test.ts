import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractErrorFromContent,
  extractResponseFromContent,
  extractTextFromContent,
} from "../src/helpers.ts";

test("extractTextFromContent joins text parts of an array", () => {
  const content = [
    { type: "text", text: "first" },
    { type: "image", data: "…" },
    { type: "text", text: "second" },
  ];

  assert.equal(extractTextFromContent(content), "first\nsecond");
});

test("extractTextFromContent ignores arrays without text parts", () => {
  assert.equal(extractTextFromContent([{ type: "image" }]), "");
  assert.equal(extractTextFromContent([]), "");
});

test("extractTextFromContent reads plain strings and text objects", () => {
  assert.equal(extractTextFromContent("plain"), "plain");
  assert.equal(extractTextFromContent({ text: "wrapped" }), "wrapped");
  assert.equal(extractTextFromContent({ other: 1 }), "");
});

test("extractTextFromContent returns an empty string for empty input", () => {
  assert.equal(extractTextFromContent(undefined), "");
  assert.equal(extractTextFromContent(null), "");
  assert.equal(extractTextFromContent(""), "");
});

test("extractErrorFromContent falls back to a JSON dump", () => {
  assert.equal(extractErrorFromContent(undefined), "Unknown error");
  assert.equal(extractErrorFromContent([{ type: "text", text: "boom" }]), "boom");
  assert.equal(extractErrorFromContent({ code: 42 }), '{"code":42}');
});

test("extractResponseFromContent unwraps text parts into output", () => {
  assert.deepEqual(extractResponseFromContent([{ type: "text", text: "hi" }]), {
    output: "hi",
  });
});

test("extractResponseFromContent passes objects through", () => {
  assert.deepEqual(extractResponseFromContent({ output: "hi", extra: 1 }), {
    output: "hi",
    extra: 1,
  });
});

test("extractResponseFromContent wraps strings", () => {
  assert.deepEqual(extractResponseFromContent("hi"), { output: "hi" });
});

test("extractResponseFromContent returns an empty object for empty input", () => {
  assert.deepEqual(extractResponseFromContent(undefined), {});
  assert.deepEqual(extractResponseFromContent([]), {});
});
