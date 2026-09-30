import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseToolState, startComputerUse } from "./client.mjs";

test("MCP client speaks OpenWork's line protocol", async () => {
  const connection = await startComputerUse({
    command: process.execPath,
    args: [fileURLToPath(new URL("./fake-mcp.mjs", import.meta.url))],
  });
  try {
    const result = await connection.callTool("computer_discover", {});
    const state = parseToolState(result);
    assert.equal(state.ok, true);
    assert.equal(state.tool, "computer_discover");
    assert.deepEqual(state.arguments, {});
  } finally {
    connection.stop();
  }
});
