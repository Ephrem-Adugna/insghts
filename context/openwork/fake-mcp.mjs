import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (!message.id) return;
  if (message.method === "initialize") {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: { protocolVersion: "2025-11-25", capabilities: { tools: {} } },
    })}\n`);
    return;
  }
  if (message.method === "tools/call") {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        isError: false,
        content: [{
          type: "text",
          text: JSON.stringify({ ok: true, tool: message.params.name, arguments: message.params.arguments }),
        }],
      },
    })}\n`);
  }
});
