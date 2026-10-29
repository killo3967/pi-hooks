// ============================================================================
// Helpers: extract information from content
// ============================================================================

export function extractTextFromContent(content: unknown): string {
  if (!content) return "";

  if (Array.isArray(content)) {
    const textItems = content.filter(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        item.type === "text" &&
        typeof item.text === "string",
    );

    if (textItems.length > 0) {
      return textItems.map((item) => item.text).join("\n");
    }
  }

  if (typeof content === "string") {
    return content;
  }

  if (typeof content === "object" && content !== null) {
    if ("text" in content && typeof content.text === "string") {
      return content.text;
    }
  }

  return "";
}

/**
 * Extracts an error message from tool result content
 */
export function extractErrorFromContent(content: unknown): string {
  if (!content) return "Unknown error";

  const text = extractTextFromContent(content);
  if (text) {
    return text;
  }

  return JSON.stringify(content);
}

/**
 * Extracts a response object from tool result content
 */
export function extractResponseFromContent(content: unknown): Record<string, unknown> {
  if (!content) return {};

  // content may be an array or a single object
  if (Array.isArray(content)) {
    // Build the response object
    const response: Record<string, unknown> = {};
    for (const item of content) {
      if (item.type === "text" && typeof item.text === "string") {
        response.output = item.text;
      }
    }
    return response;
  }

  if (typeof content === "object" && content !== null) {
    return content as Record<string, unknown>;
  }

  if (typeof content === "string") {
    return { output: content };
  }

  return {};
}

/**
 * One short, human-visible line describing context a hook injected. The content
 * itself stays hidden, but an injection should never be invisible: a model
 * steered without the user noticing is the failure mode this guards against.
 */
export function describeInjectedContext(label: string, content: string): string {
  const lines = content.split("\n").length;
  const unit = lines === 1 ? "line" : "lines";
  return `pi-hooks: ${label} hook injected context (${lines} ${unit}, not shown here)`;
}
