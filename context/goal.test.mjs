import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseGoal, validateGoal } from "./goal.mjs";
import { refreshFromDisk, refreshOnce } from "./refresh.mjs";
import { latelyFiles } from "./paths.mjs";
import { writeJson } from "./store.mjs";
import { formatEvent, transcriptFromEvents } from "./transcript.mjs";
import { withOllamaLock } from "./ollama.mjs";

const concrete = "Send the Q3 lab invoice to finance";

test("parseGoal accepts a concrete JSON goal", () => {
  const parsed = parseGoal(`Sure\n\`\`\`json\n{"goal":"${concrete}"}\n\`\`\``);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.goal, concrete);
});

test("parseGoal accepts a Goal line", () => {
  const parsed = parseGoal("Goal: Reply to Maya about the lab invoice");
  assert.equal(parsed.ok, true);
  assert.match(parsed.goal, /Reply to Maya/);
});

test("parseGoal rejects vague labels, Plato states, and guessed prompts", () => {
  assert.equal(parseGoal('{"goal":"coding"}').reason, "vague");
  assert.equal(parseGoal('{"goal":"browsing the web"}').reason, "vague");
  assert.equal(parseGoal("working").reason, "vague");
  assert.equal(parseGoal('{"goal":"Finish the Plato classification for the dialogue"}').reason, "plato");
  assert.equal(parseGoal('{"state":"philosopher"}').reason, "plato");
  assert.equal(parseGoal('{"prompt":"how do I center a div"}').reason, "prompt");
  assert.equal(parseGoal('{"goal":"Draft the next prompt for the support bot in Slack"}').reason, "prompt");
  assert.equal(parseGoal('{"goal":"How do I center a div in the page?"}').reason, "prompt");
  assert.equal(parseGoal('{"goal":null}').reason, "declined");
  assert.equal(parseGoal("").reason, "empty");
  assert.equal(validateGoal("Fix the bug").reason, "vague");
});

test("parseGoal keeps a specific outcome", () => {
  const parsed = parseGoal('{"goal":"Finish the pull request description for the Insight activity dashboard"}');
  assert.equal(parsed.ok, true);
  assert.match(parsed.goal, /pull request description/);
});

test("transcript hides password text and keeps apps, pages, and files", () => {
  const text = transcriptFromEvents([
    { ts: "t1", type: "frontmost", app: "Safari", bundleId: "com.apple.Safari" },
    { ts: "t2", type: "url", app: "Safari", url: "https://example.com/invoice" },
    { ts: "t3", type: "file", path: "/Users/me/invoice.pdf" },
    { ts: "t4", type: "text", op: "typed", text: "hello finance" },
    { ts: "t5", type: "text", op: "typed", hidden: true, reason: "password", text: "hunter2" },
    { ts: "t6", type: "clipboard", hidden: true, reason: "password", text: "secret-clipboard" },
    { ts: "t7", type: "text", op: "typed", text: "sk-live-abcdefghijk" },
  ]);
  assert.match(text, /Safari/);
  assert.match(text, /https:\/\/example.com\/invoice/);
  assert.match(text, /invoice.pdf/);
  assert.match(text, /hello finance/);
  assert.equal(text.includes("hunter2"), false);
  assert.equal(text.includes("secret-clipboard"), false);
  assert.match(text, /\[secret\]/);
  assert.match(formatEvent({ type: "text", hidden: true, text: "hunter2" }), /password field/);
});

test("refresh skips a pause, an unchanged transcript, and an unusable model reply", async () => {
  const events = [{ type: "frontmost", app: "Mail", bundleId: "com.apple.mail" }, { type: "text", op: "typed", text: "invoice for the lab" }];
  const paused = await refreshOnce({ recording: false, events, model: "llama3.1:8b", generate: async () => { throw new Error("called"); } });
  assert.equal(paused.skipped, "paused");

  let calls = 0;
  const first = await refreshOnce({
    recording: true,
    events,
    model: "llama3.1:8b",
    now: "2026-09-30T00:00:00.000Z",
    generate: async () => {
      calls += 1;
      return `{"goal":"${concrete}"}`;
    },
  });
  assert.equal(calls, 1);
  assert.equal(first.summary.goal, concrete);
  assert.equal(first.summary.kind, "goal");

  const again = await refreshOnce({
    recording: true,
    events,
    previous: first.summary,
    model: "llama3.1:8b",
    generate: async () => {
      calls += 1;
      return `{"goal":"${concrete}"}`;
    },
  });
  assert.equal(again.skipped, "unchanged");
  assert.equal(calls, 1);

  const vague = await refreshOnce({
    recording: true,
    events: [...events, { type: "text", op: "typed", text: "more detail about the invoice" }],
    previous: first.summary,
    model: "llama3.1:8b",
    generate: async () => '{"goal":"coding"}',
  });
  assert.equal(vague.skipped, "unusable");
  assert.equal(vague.previous.goal, concrete);
});

test("refreshFromDisk does not stack overlapping Ollama calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lately-refresh-"));
  const files = latelyFiles(dir);
  await writeJson(files.recording, { recording: true });
  await writeJson(files.events, {});
  const { writeFile } = await import("node:fs/promises");
  await writeFile(files.events, `${JSON.stringify({ type: "text", op: "typed", text: "send the lab invoice to finance" })}\n`);
  let active = 0;
  let max = 0;
  const fetchImpl = async () => {
    active += 1;
    max = Math.max(max, active);
    await new Promise((resolve) => setTimeout(resolve, 60));
    active -= 1;
    return { ok: true, json: async () => ({ response: `{"goal":"${concrete}"}` }) };
  };
  const env = { OLLAMA_HOST: "http://127.0.0.1:11434", LATELY_MODEL: "llama3.1:8b" };
  const [left, right] = await Promise.all([
    refreshFromDisk({ files, env, fetchImpl }),
    refreshFromDisk({ files, env, fetchImpl }),
  ]);
  assert.equal(max, 1);
  assert.equal([left.skipped, right.skipped].includes("busy"), true);
  assert.equal([left, right].some((result) => result.summary?.goal === concrete), true);
  await rm(dir, { recursive: true, force: true });
});

test("ollama lock serializes overlapping work", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lately-lock-"));
  const lock = join(dir, "ollama.lock");
  let active = 0;
  let max = 0;
  const run = () => withOllamaLock(lock, async () => {
    active += 1;
    max = Math.max(max, active);
    await new Promise((resolve) => setTimeout(resolve, 40));
    active -= 1;
    return "done";
  });
  const results = await Promise.all([run(), run()]);
  assert.deepEqual(results.sort(), ["done", "done"]);
  assert.equal(max, 1);
  await rm(dir, { recursive: true, force: true });
});
