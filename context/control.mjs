import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { isDirectRun } from "./direct.mjs";
import { validateGoal } from "./goal.mjs";
import { notifyMac } from "./notify.mjs";
import { ollamaConfig, ollamaGenerate, ollamaReady, withOllamaLock } from "./ollama.mjs";
import { latelyFiles, supportDir } from "./paths.mjs";
import { readEvents, readJson, writeJson } from "./store.mjs";
import { transcriptFromEvents } from "./transcript.mjs";
import { startComputerUse } from "./openwork/client.mjs";
import { createPlanner, runGoalControl } from "./openwork/loop.mjs";

export async function runControlSession({
  files,
  env = process.env,
  signal,
  abort,
  notify,
  announceAbort = true,
  run = runGoalControl,
  connect = startComputerUse,
  createPlan = createPlanner,
  fetchImpl = fetch,
  includeImage = env.LATELY_INCLUDE_IMAGE === "1",
  maxTurns = Number(env.LATELY_MAX_TURNS || 16),
}) {
  const recording = await readJson(files.recording, null);
  const summary = await readJson(files.summary, null);
  const goal = validateGoal(summary?.goal);
  if (recording?.recording !== true) {
    if (announceAbort) await notify?.("Lately is paused, so it will not control the computer.");
    return { ok: false, stopped: true, reason: "paused" };
  }
  if (!goal.ok) {
    await notify?.("Lately does not have a concrete goal yet, so it will not act.");
    return { ok: false, stopped: true, reason: "goal" };
  }
  if (existsSync(files.stop)) {
    if (announceAbort) await notify?.("Control stopped.");
    return { ok: false, stopped: true, reason: "stopped" };
  }

  let host;
  let model;
  try {
    ({ host, model } = ollamaConfig(env));
  } catch (error) {
    await notify?.(error.message);
    return { ok: false, stopped: true, reason: "ollama" };
  }
  const ready = await ollamaReady({ host, model, fetchImpl });
  if (!ready.ok) {
    await notify?.(ready.reason === "model"
      ? `Ollama does not have ${model}, so Lately will not act.`
      : "Ollama is not running, so Lately will not act.");
    return { ok: false, stopped: true, reason: ready.reason === "model" ? "model" : "ollama" };
  }

  const events = await readEvents(files.events);
  const transcript = transcriptFromEvents(events);
  await writeJson(files.control, {
    controlling: true,
    goal: goal.goal,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    status: "Starting",
  });

  const stopSession = typeof abort === "function" ? abort : () => {};
  const watcher = setInterval(() => {
    if (signal?.aborted) return;
    if (existsSync(files.stop)) {
      stopSession();
      return;
    }
    try {
      const current = JSON.parse(readFileSync(files.recording, "utf8"));
      if (current?.recording === false) stopSession();
    } catch {
      // A torn read is not a pause. Only an explicit pause stops control.
    }
  }, 100);
  watcher.unref?.();

  const notifyStatus = async (message) => {
    const current = await readJson(files.control, {});
    if (current?.controlling !== false) {
      await writeJson(files.control, {
        ...current,
        controlling: true,
        goal: goal.goal,
        pid: process.pid,
        status: message,
      });
    }
    await notify?.(message);
  };

  let connection;
  try {
    try {
      connection = await connect({});
    } catch (error) {
      await notify?.(error.message || "Could not start computer control.");
      return { ok: false, stopped: true, reason: error.code || "connect" };
    }
    if (connection?.pid) {
      const current = await readJson(files.control, {});
      await writeJson(files.control, { ...current, helperPid: connection.pid, controlling: true, pid: process.pid });
    }
    const plan = createPlan({
      allowPointer: includeImage,
      generate: async (prompt, options = {}) => {
        const result = await withOllamaLock(files.lock, () => ollamaGenerate({
          host,
          model,
          prompt,
          signal: options.signal ?? signal,
          fetchImpl,
        }));
        if (result && typeof result === "object" && result.busy) {
          throw Object.assign(new Error("Ollama is busy, so Lately stopped rather than stacking another call."), {
            code: "ollama",
          });
        }
        return result;
      },
    });
    return await run({
      goal: goal.goal,
      transcript,
      callTool: (name, args, options) => connection.callTool(name, args, options),
      plan,
      notify: notifyStatus,
      signal,
      announceAbort,
      includeImage,
      maxTurns,
      isRecording: async () => {
        if (existsSync(files.stop)) return false;
        const current = await readJson(files.recording, null);
        if (!current || typeof current.recording !== "boolean") return true;
        return current.recording === true;
      },
    });
  } finally {
    clearInterval(watcher);
    try { connection?.stop?.(); } catch { /* helper already exited */ }
    await writeJson(files.control, {
      controlling: false,
      goal: goal.goal,
      pid: process.pid,
      stoppedAt: new Date().toISOString(),
      status: "Idle",
    }).catch(() => {});
  }
}

async function main() {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  const files = latelyFiles(supportDir());
  await mkdir(files.dir, { recursive: true });
  await runControlSession({
    files,
    signal: controller.signal,
    abort: () => controller.abort(),
    announceAbort: process.env.LATELY_ANNOUNCE_ABORT !== "0",
    notify: (body) => notifyMac(body),
  });
  if (existsSync(files.stop)) {
    try { unlinkSync(files.stop); } catch { /* another start may replace it */ }
  }
}

if (isDirectRun(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
