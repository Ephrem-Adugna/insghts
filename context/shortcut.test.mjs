import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { latelyFiles } from "./paths.mjs";
import { writeJson } from "./store.mjs";
import { decideShortcut, loadShortcutState } from "./shortcut.mjs";
import { assertLoopback } from "./ollama.mjs";
import { runControlSession } from "./control.mjs";

const goal = "Send the Q3 lab invoice to finance";

function ready(models = [{ name: "llama3.1:8b" }]) {
  return async () => ({ ok: true, json: async () => ({ models }) });
}

test("shortcut starts only when idle, recording, Ollama, and a concrete goal are ready", () => {
  const decision = decideShortcut({
    controlling: false,
    recording: true,
    ollamaReachable: true,
    goal,
  });
  assert.equal(decision.action, "start");
  assert.equal(decision.start, true);
  assert.equal(decision.notification, `Goal: ${goal}`);
  assert.equal(decision.goal, goal);
});

test("a second press stops and does not start another goal", () => {
  const first = decideShortcut({
    controlling: false,
    recording: true,
    ollamaReachable: true,
    goal,
  });
  assert.equal(first.action, "start");
  const second = decideShortcut({
    controlling: true,
    recording: true,
    ollamaReachable: true,
    goal: "Reply to Maya about a different invoice",
  });
  assert.equal(second.action, "stop");
  assert.equal(second.start, false);
  assert.equal(second.notification, "Control stopped.");
});

test("shortcut stops immediately while control is running and does not start", () => {
  const decision = decideShortcut({
    controlling: true,
    recording: true,
    ollamaReachable: false,
    ollamaReason: "down",
    goal: "Reply to Maya about a different invoice",
  });
  assert.equal(decision.action, "stop");
  assert.equal(decision.start, false);
  assert.equal(decision.notification, "Control stopped.");
  assert.equal("goal" in decision, false);
});

test("shortcut refuses to act when paused, when Ollama is down, or when the goal is not concrete", () => {
  const paused = decideShortcut({ controlling: false, recording: false, ollamaReachable: true, goal });
  assert.equal(paused.start, false);
  assert.equal(paused.reason, "paused");
  assert.match(paused.notification, /paused/);

  const down = decideShortcut({ controlling: false, recording: true, ollamaReachable: false, ollamaReason: "down", goal });
  assert.equal(down.reason, "ollama");
  assert.match(down.notification, /Ollama is not running/);
  assert.equal(down.start, false);

  const missing = decideShortcut({
    controlling: false,
    recording: true,
    ollamaReachable: false,
    ollamaReason: "model",
    model: "llama3.1:8b",
    goal,
  });
  assert.match(missing.notification, /llama3.1:8b/);
  assert.equal(missing.start, false);

  const vague = decideShortcut({ controlling: false, recording: true, ollamaReachable: true, goal: "coding" });
  assert.equal(vague.reason, "goal");
  assert.equal(vague.start, false);

  const prompt = decideShortcut({
    controlling: false,
    recording: true,
    ollamaReachable: true,
    goal: "Draft the next prompt for the support bot in Slack",
  });
  assert.equal(prompt.start, false);
});

test("a dead control pid does not count as controlling", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lately-shortcut-"));
  const files = latelyFiles(dir);
  await writeJson(files.recording, { recording: true });
  await writeJson(files.summary, { goal });
  await writeJson(files.control, { controlling: true, pid: 2_000_000_000 });
  const state = await loadShortcutState({
    files,
    env: { OLLAMA_HOST: "http://127.0.0.1:11434", LATELY_MODEL: "llama3.1:8b" },
    fetchImpl: ready(),
    pidAliveImpl: () => false,
  });
  const decision = decideShortcut(state);
  assert.equal(state.controlling, false);
  assert.equal(decision.action, "start");
  assert.equal(decision.notification, `Goal: ${goal}`);
  await rm(dir, { recursive: true, force: true });
});

test("a live control pid makes the shortcut stop", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lately-shortcut-live-"));
  const files = latelyFiles(dir);
  await writeJson(files.recording, { recording: true });
  await writeJson(files.summary, { goal });
  await writeJson(files.control, { controlling: true, pid: process.pid });
  const state = await loadShortcutState({
    files,
    env: { OLLAMA_HOST: "http://127.0.0.1:11434", LATELY_MODEL: "llama3.1:8b" },
    fetchImpl: ready(),
    pidAliveImpl: (pid) => pid === process.pid,
  });
  const decision = decideShortcut(state);
  assert.equal(decision.action, "stop");
  assert.equal(decision.notification, "Control stopped.");
  await rm(dir, { recursive: true, force: true });
});

test("control does not connect when Ollama is remote or the model is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lately-control-"));
  const files = latelyFiles(dir);
  await writeJson(files.recording, { recording: true });
  await writeJson(files.summary, { goal });
  const notes = [];
  let connected = false;
  assert.throws(() => assertLoopback("http://example.com:11434"), /this computer/);
  const remote = await runControlSession({
    files,
    env: { OLLAMA_HOST: "http://example.com:11434", LATELY_MODEL: "llama3.1:8b" },
    signal: new AbortController().signal,
    notify: (message) => notes.push(message),
    connect: async () => {
      connected = true;
      return { callTool() {}, stop() {} };
    },
  });
  assert.equal(remote.reason, "ollama");
  assert.equal(connected, false);
  assert.match(notes.join(" "), /this computer/);

  const missing = await runControlSession({
    files,
    env: { OLLAMA_HOST: "http://127.0.0.1:11434", LATELY_MODEL: "llama3.1:8b" },
    signal: new AbortController().signal,
    fetchImpl: ready([{ name: "qwen2.5:0.5b" }]),
    notify: (message) => notes.push(message),
    connect: async () => {
      connected = true;
      return { callTool() {}, stop() {} };
    },
  });
  assert.equal(missing.reason, "model");
  assert.equal(connected, false);
  assert.match(notes.join("\n"), /will not act/);
  await rm(dir, { recursive: true, force: true });
});
