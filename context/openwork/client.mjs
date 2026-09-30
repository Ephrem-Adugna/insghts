import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function computerUseBinary() {
  return fileURLToPath(new URL("./computer-use/native/.build/release/ComputerUse", import.meta.url));
}

export function parseToolState(result) {
  const text = result?.content?.find((part) => part.type === "text" && typeof part.text === "string")?.text;
  if (!text) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

// Line-delimited MCP client for OpenWork's `ComputerUse mcp` helper.
// The helper owns approval, the floating control panel, and input dispatch.
export async function startComputerUse({ command, args = ["mcp"], env, signal } = {}) {
  if (!command && process.platform !== "darwin") {
    const error = new Error("Computer control only runs on macOS, so Lately will not act.");
    error.code = "not-mac";
    throw error;
  }
  const exe = command ?? computerUseBinary();
  if (!existsSync(exe)) {
    const error = new Error("The Computer Use helper is not built, so Lately will not act.");
    error.code = "helper-missing";
    throw error;
  }
  const child = spawn(exe, args, {
    stdio: ["pipe", "pipe", "inherit"],
    env: env ?? process.env,
  });
  const pending = new Map();
  let nextId = 0;
  let buffer = "";
  let closed = false;

  const failAll = (error) => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id == null) continue;
      const waiter = pending.get(String(message.id));
      if (!waiter) continue;
      pending.delete(String(message.id));
      waiter.settle(message);
    }
  });
  child.on("error", (error) => failAll(error));
  child.on("exit", () => {
    closed = true;
    failAll(Object.assign(new Error("Computer Use helper exited."), { code: "helper-exited" }));
  });

  const send = (message) => {
    if (closed || !child.stdin.writable) {
      throw Object.assign(new Error("Computer Use helper is gone."), { code: "helper-exited" });
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const request = (method, params, requestSignal) => new Promise((resolve, reject) => {
    const id = ++nextId;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      requestSignal?.removeEventListener("abort", onAbort);
      fn(value);
    };
    const onAbort = () => {
      try {
        send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id } });
      } catch {
        // The helper is already gone.
      }
      pending.delete(String(id));
      finish(reject, Object.assign(new Error("Control stopped."), { name: "AbortError" }));
    };
    pending.set(String(id), {
      settle(message) {
        if (message.error) {
          finish(reject, Object.assign(new Error(message.error.message || "Computer Use request failed."), {
            code: "mcp",
          }));
          return;
        }
        finish(resolve, message.result);
      },
      reject(error) {
        finish(reject, error);
      },
    });
    if (requestSignal?.aborted) {
      onAbort();
      return;
    }
    requestSignal?.addEventListener("abort", onAbort, { once: true });
    try {
      send({ jsonrpc: "2.0", id, method, params });
    } catch (error) {
      pending.delete(String(id));
      finish(reject, error);
    }
  });

  try {
    await request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "lately", version: "0.1.0" },
    }, signal);
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
  } catch (error) {
    try { child.kill("SIGTERM"); } catch { /* already exited */ }
    throw error;
  }

  return {
    pid: child.pid,
    callTool(name, args = {}, options = {}) {
      return request("tools/call", { name, arguments: args ?? {} }, options.signal);
    },
    stop() {
      if (closed) return;
      closed = true;
      try { child.kill("SIGTERM"); } catch { /* already exited */ }
      const timer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* already exited */ }
      }, 400);
      timer.unref?.();
    },
  };
}
