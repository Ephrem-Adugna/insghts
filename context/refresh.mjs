import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { goalPrompt, parseGoal } from "./goal.mjs";
import { transcriptFromEvents } from "./transcript.mjs";
import { isDirectRun } from "./direct.mjs";
import { latelyFiles, supportDir } from "./paths.mjs";
import { readEvents, readJson, writeJson } from "./store.mjs";
import { ollamaConfig, ollamaGenerate, withOllamaLock } from "./ollama.mjs";

export async function refreshOnce({
  recording,
  events,
  previous = null,
  model,
  generate,
  now = new Date().toISOString(),
  maxChars = 12000,
}) {
  if (recording !== true) return { skipped: "paused" };
  const transcript = transcriptFromEvents(events, { maxChars });
  if (!transcript) return { skipped: "empty" };
  const transcriptHash = createHash("sha256").update(transcript).digest("hex");
  if (previous?.transcriptHash === transcriptHash && typeof previous.goal === "string") {
    return { skipped: "unchanged", summary: previous };
  }
  const raw = await generate(goalPrompt(transcript));
  const parsed = parseGoal(raw);
  if (!parsed.ok) {
    return { skipped: "unusable", reason: parsed.reason, previous: previous ?? null };
  }
  return {
    skipped: null,
    summary: {
      kind: "goal",
      goal: parsed.goal,
      updatedAt: now,
      model,
      transcriptHash,
    },
  };
}

export async function refreshFromDisk({
  files = latelyFiles(),
  env = process.env,
  fetchImpl = fetch,
  now = new Date().toISOString(),
} = {}) {
  const recording = await readJson(files.recording, null);
  await mkdir(files.dir, { recursive: true });
  if (recording?.recording !== true) {
    await writeJson(files.status, { ok: true, message: "Recording is paused.", at: now });
    return { skipped: "paused" };
  }
  const { host, model } = ollamaConfig(env);
  const locked = await withOllamaLock(files.lock, async () => {
    const events = await readEvents(files.events);
    const previous = await readJson(files.summary, null);
    return refreshOnce({
      recording: true,
      events,
      previous,
      model,
      now,
      generate: (prompt) => ollamaGenerate({ host, model, prompt, fetchImpl }),
    });
  }, { waitMs: 0 });
  if (locked?.busy) return { skipped: "busy" };
  if (locked.summary && !locked.skipped) await writeJson(files.summary, locked.summary);
  if (locked.skipped === "unusable") {
    await writeJson(files.status, {
      ok: false,
      message: "The model did not return a concrete goal, so the saved goal was left unchanged.",
      at: now,
    });
  } else if (!locked.skipped) {
    await writeJson(files.status, { ok: true, message: "", at: now });
  }
  return locked;
}

async function main() {
  try {
    const result = await refreshFromDisk({ files: latelyFiles(supportDir()) });
    process.stdout.write(`${JSON.stringify({ skipped: result.skipped ?? null, goal: result.summary?.goal ?? null })}\n`);
  } catch (error) {
    const files = latelyFiles(supportDir());
    const message = error.code === "ollama" || /Ollama|local http|this computer/i.test(error.message)
      ? `${error.message} Lately will not invent a goal.`
      : error.message;
    await writeJson(files.status, { ok: false, message, at: new Date().toISOString() }).catch(() => {});
    process.stderr.write(`${message}\n`);
    process.exitCode = 0;
  }
}

if (isDirectRun(import.meta.url)) await main();
