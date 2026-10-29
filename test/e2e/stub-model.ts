import { createServer } from "node:http";

/**
 * A stand-in for the model, so an end-to-end run needs no credentials and is
 * deterministic. It answers /v1/chat/completions with the server-sent-events
 * shape Pi expects from an `openai-completions` provider.
 *
 * The script is a list of replies, consumed in order: each request gets the
 * next one, and the last reply repeats. A reply is either plain text or a tool
 * call, which is what lets a test drive Pi through a real tool event.
 */
export type StubReply =
  | { text: string }
  | { toolCall: { name: string; arguments: Record<string, unknown> } };

export type StubModel = {
  url: string;
  requests: Array<{ path: string; body: Record<string, unknown> }>;
  close: () => Promise<void>;
};

const CHUNK_BASE = {
  id: "chatcmpl-stub",
  object: "chat.completion.chunk",
  created: 0,
  model: "stub-model",
};

function chunk(delta: Record<string, unknown>, finishReason: string | null) {
  return `data: ${JSON.stringify({
    ...CHUNK_BASE,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

export async function startStubModel(script: StubReply[]): Promise<StubModel> {
  const requests: StubModel["requests"] = [];
  let served = 0;

  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (piece) => {
      raw += piece;
    });
    request.on("end", () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      requests.push({ path: request.url ?? "", body });

      const reply = script[Math.min(served, script.length - 1)] ?? { text: "" };
      served += 1;

      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });

      if ("toolCall" in reply) {
        response.write(
          chunk(
            {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: `call_${served}`,
                  type: "function",
                  function: {
                    name: reply.toolCall.name,
                    arguments: JSON.stringify(reply.toolCall.arguments),
                  },
                },
              ],
            },
            null,
          ),
        );
        response.write(chunk({}, "tool_calls"));
      } else {
        response.write(chunk({ role: "assistant", content: reply.text }, null));
        response.write(chunk({}, "stop"));
      }

      response.write("data: [DONE]\n\n");
      response.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
