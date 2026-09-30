import process from "node:process";
import { isDirectRun } from "./direct.mjs";
import { latelyFiles, supportDir } from "./paths.mjs";
import { readJson } from "./store.mjs";
import { ollamaConfig, ollamaReady } from "./ollama.mjs";
import { validateGoal } from "./goal.mjs";

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function decideShortcut(state) {
  if (state.controlling) {
    return {
      action: "stop",
      start: false,
      notification: "Control stopped.",
    };
  }
  if (state.recording !== true) {
    return {
      action: "blocked",
      start: false,
      reason: "paused",
      notification: "Lately is paused, so it will not control the computer.",
    };
  }
  if (!state.ollamaReachable) {
    const notification = state.ollamaReason === "model"
      ? `Ollama does not have ${state.model || "the selected model"}, so Lately will not act.`
      : "Ollama is not running, so Lately will not act.";
    return {
      action: "blocked",
      start: false,
      reason: state.ollamaReason === "model" ? "model" : "ollama",
      notification,
    };
  }
  const parsed = validateGoal(state.goal);
  if (!parsed.ok) {
    return {
      action: "blocked",
      start: false,
      reason: "goal",
      notification: "Lately does not have a concrete goal yet, so it will not act.",
    };
  }
  return {
    action: "start",
    start: true,
    goal: parsed.goal,
    notification: `Goal: ${parsed.goal}`,
  };
}

export async function loadShortcutState({
  files = latelyFiles(),
  env = process.env,
  fetchImpl = fetch,
  pidAliveImpl = pidAlive,
} = {}) {
  const recording = await readJson(files.recording, null);
  const summary = await readJson(files.summary, null);
  const control = await readJson(files.control, null);
  const { host, model } = ollamaConfig(env);
  const ready = await ollamaReady({ host, model, fetchImpl });
  const controlling = Boolean(control?.controlling) && pidAliveImpl(control?.pid);
  return {
    controlling,
    recording: recording?.recording === true,
    ollamaReachable: ready.ok,
    ollamaReason: ready.reason || null,
    model,
    goal: typeof summary?.goal === "string" ? summary.goal : null,
  };
}

async function main() {
  const decision = decideShortcut(await loadShortcutState({ files: latelyFiles(supportDir()) }));
  process.stdout.write(`${JSON.stringify(decision)}\n`);
}

if (isDirectRun(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.stdout.write(`${JSON.stringify({
      action: "blocked",
      start: false,
      reason: "error",
      notification: "Lately could not read the goal, so it will not act.",
    })}\n`);
    process.exitCode = 1;
  });
}
