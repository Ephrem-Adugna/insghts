const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

export function ollamaConfig(env = process.env) {
  const host = (env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = env.LATELY_MODEL || "llama3.1:8b";
  assertLoopback(host);
  return { host, model };
}

export function assertLoopback(host) {
  let url;
  try {
    url = new URL(host);
  } catch {
    throw new Error("OLLAMA_HOST must be a local http URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("OLLAMA_HOST must be http or https on this computer.");
  }
  const name = url.hostname.replace(/^\[|\]$/g, "");
  if (!LOOPBACK.has(name)) {
    throw new Error("Lately only talks to Ollama on this computer. Raw activity is not uploaded.");
  }
  return url;
}

export async function ollamaReady({ host, model, fetchImpl = fetch, timeoutMs = 1500 } = {}) {
  assertLoopback(host);
  try {
    const response = await fetchImpl(`${host}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return { ok: false, reason: "down" };
    const body = await response.json();
    const names = Array.isArray(body.models) ? body.models.map((item) => item.name).filter(Boolean) : [];
    const ready = names.some((name) => name === model || name.startsWith(`${model}:`) || model.startsWith(`${name}:`) || model === name.split(":")[0]);
    if (!ready) return { ok: false, reason: "model", model };
    return { ok: true, model };
  } catch {
    return { ok: false, reason: "down" };
  }
}

export async function ollamaGenerate({ host, model, prompt, signal, fetchImpl = fetch, timeoutMs = 90000 }) {
  assertLoopback(host);
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetchImpl(`${host}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: 0.2, num_predict: 220 },
    }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    const error = new Error(`Ollama could not run ${model} (${response.status}).`);
    error.code = "ollama";
    throw error;
  }
  const payload = await response.json();
  return String(payload.response ?? "");
}

export async function withOllamaLock(lockPath, fn, { waitMs = 120000 } = {}) {
  const { open, stat, unlink } = await import("node:fs/promises");
  const start = Date.now();
  for (;;) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(`${process.pid}\n`);
        return await fn();
      } finally {
        await handle.close();
        await unlink(lockPath).catch(() => {});
      }
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > 180000) {
          await unlink(lockPath).catch(() => {});
          continue;
        }
      } catch {
        // The holder removed the lock between checks.
      }
      if (waitMs <= 0 || Date.now() - start >= waitMs) return { busy: true };
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
