// Action loop adapted from OpenWork's computer-use session
// (https://github.com/different-ai/openwork, packages/computer-use, MIT).
// Click, type, and app control stay in that native helper. This file plans
// with local Ollama and stops when the shortcut, a pause, or a denial says so.
import { openComputerSession, ComputerUseError } from "./computer-use/src/session.mjs";
import {
  actionPrompt,
  actionTargetsPassword,
  appPrompt,
  describeAction,
  parseActionDecision,
  parseAppChoice,
  resolveApp,
} from "./actions.mjs";
import { parseToolState } from "./client.mjs";

export function createPlanner({ generate, allowPointer = false }) {
  return {
    async chooseApp({ goal, transcript, apps, signal }) {
      let raw;
      try {
        raw = await generate(appPrompt({ goal, transcript, apps }), { signal });
      } catch (error) {
        if (aborted(signal, error)) throw error;
        throw Object.assign(new Error("Ollama is not running, so Lately will not act."), { code: "ollama" });
      }
      return resolveApp({ parsed: parseAppChoice(raw, apps), apps, transcript });
    },
    async nextAction({ goal, transcript, observation, signal }) {
      const raw = await generate(actionPrompt({ goal, transcript, observation, allowPointer }), { signal });
      const decision = parseActionDecision(raw, { allowPointer });
      if (decision.ok && !decision.done && actionTargetsPassword(decision.action, observation?.elements)) {
        return {
          ok: false,
          reason: "password",
          say: "This step would type into a password field. Lately stopped so you can type it.",
        };
      }
      return decision;
    },
  };
}

export async function runGoalControl({
  goal,
  transcript = "",
  callTool,
  plan,
  notify,
  signal,
  isRecording = async () => true,
  includeImage = false,
  maxTurns = 16,
  announceAbort = true,
}) {
  const notes = [];
  const say = async (message) => {
    if (!message) return;
    notes.push(message);
    try {
      await notify?.(message);
    } catch {
      // A missed banner must not hide the OpenWork panel or keep acting blindly.
    }
  };
  const stopped = async (reason, extra = {}) => {
    if (reason === "stopped" && announceAbort) await say("Control stopped.");
    return { ok: false, stopped: true, done: false, reason, notes, ...extra };
  };

  if (signal?.aborted) return stopped("stopped");
  if (!(await isRecording())) {
    if (announceAbort) await say("Recording is paused, so Lately will not control the computer.");
    return { ok: false, stopped: true, done: false, reason: "paused", notes };
  }

  let discovered;
  try {
    discovered = await callTool("computer_discover", {}, { signal });
  } catch (error) {
    if (aborted(signal, error)) return stopped("stopped");
    await say(error.message || "Computer Use did not answer, so Lately will not act.");
    return { ok: false, stopped: true, done: false, reason: "discover-failed", notes };
  }
  const found = parseToolState(discovered);
  if (!found?.permissions?.accessibility || !found?.permissions?.screenRecording) {
    await say("Computer control needs Accessibility and Screen Recording for the OpenWork helper. Lately will not act.");
    return { ok: false, stopped: true, done: false, reason: "permissions", notes };
  }

  let choice;
  try {
    choice = await plan.chooseApp({ goal, transcript, apps: found.apps || [], signal });
  } catch (error) {
    if (aborted(signal, error)) return stopped("stopped");
    await say(error.message || "Could not choose an app, so Lately will not act.");
    return { ok: false, stopped: true, done: false, reason: error.code || "choose-failed", notes };
  }
  if (!choice?.ok) {
    await say(choice?.say || "No app was chosen, so Lately will not act.");
    return { ok: false, stopped: true, done: false, reason: choice?.reason || "no-app", notes };
  }
  if (signal?.aborted) return stopped("stopped");

  const waiting = choice.source === "transcript"
    ? `${choice.say} Goal: ${goal}`
    : `Waiting for you to allow ${choice.appName}. Goal: ${goal}`;
  await say(waiting);

  let session;
  try {
    session = await openComputerSession({
      callTool,
      appId: choice.appId,
      pid: choice.pid,
      purpose: String(goal).slice(0, 500),
      mode: "control",
      signal,
    });
  } catch (error) {
    if (aborted(signal, error)) return stopped("stopped");
    if (error instanceof ComputerUseError && error.code === "access_denied") {
      await say("You declined control. Lately stopped.");
      return { ok: false, stopped: true, done: false, reason: "denied", notes };
    }
    await say(error.message || "Could not start control.");
    return { ok: false, stopped: true, done: false, reason: error.code || "open-failed", notes };
  }

  try {
    await say(`Control started for: ${goal}`);
    let observed = await observeFresh(session, includeImage, signal);
    for (let turn = 0; turn < maxTurns; turn += 1) {
      if (signal?.aborted) return stopped("stopped", { turns: turn });
      if (!(await isRecording())) {
        if (announceAbort) await say("Recording paused. Control stopped.");
        return { ok: false, stopped: true, done: false, reason: "paused", notes, turns: turn };
      }
      let decision;
      try {
        decision = await plan.nextAction({
          goal,
          transcript,
          observation: observed.state,
          signal,
        });
      } catch (error) {
        if (aborted(signal, error)) return stopped("stopped", { turns: turn });
        await say("Ollama is not running, so Lately stopped and did not keep acting.");
        return { ok: false, stopped: true, done: false, reason: "ollama", notes, turns: turn };
      }
      if (!decision?.ok) {
        await say(decision?.say || "Lately stopped.");
        return { ok: false, stopped: true, done: false, reason: decision?.reason || "no-action", notes, turns: turn };
      }
      if (decision.done) {
        await say(decision.say || "Done.");
        return { ok: true, stopped: false, done: true, reason: "done", notes, turns: turn, appId: choice.appId };
      }
      const checked = parseActionDecision(JSON.stringify({
        done: false,
        say: decision.say,
        action: decision.action,
      }), { allowPointer: includeImage });
      if (!checked.ok || checked.done) {
        await say(checked.say || "That action is not allowed, so Lately stopped.");
        return { ok: false, stopped: true, done: false, reason: checked.reason || "no-action", notes, turns: turn };
      }
      if (actionTargetsPassword(checked.action, observed.state?.elements)) {
        await say("This step would type into a password field. Lately stopped so you can type it.");
        return { ok: false, stopped: true, done: false, reason: "password", notes, turns: turn };
      }
      decision.action = checked.action;
      await say(decision.say || describeAction(decision.action));
      try {
        observed = await session.act(decision.action, { includeImage });
      } catch (error) {
        if (aborted(signal, error)) return stopped("stopped", { turns: turn + 1 });
        if (recoverable(error)) {
          await say(error.code === "user_interacting"
            ? "You took over. Looking again before doing anything else."
            : "The window changed. Looking again.");
          observed = await observeFresh(session, includeImage, signal);
          continue;
        }
        await say(error.message || "Control hit an error and stopped.");
        return {
          ok: false,
          stopped: true,
          done: false,
          reason: error.code || "act-failed",
          notes,
          turns: turn + 1,
        };
      }
    }
    await say("Stopped after the step limit. The goal may still be unfinished.");
    return { ok: false, stopped: true, done: false, reason: "limit", notes, turns: maxTurns, appId: choice.appId };
  } catch (error) {
    if (aborted(signal, error)) return stopped("stopped");
    await say(error.message || "Control stopped.");
    return { ok: false, stopped: true, done: false, reason: error.code || "failed", notes };
  } finally {
    await session.close().catch(() => {});
  }
}

async function observeFresh(session, includeImage, signal) {
  let last;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await session.observe({ includeImage });
    } catch (error) {
      last = error;
      if (aborted(signal, error) || !recoverable(error)) throw error;
      await delay(1100, signal);
    }
  }
  throw last ?? new Error("The window kept changing.");
}

function recoverable(error) {
  return ["user_interacting", "requery_required", "stale_observation", "observation_after_action_failed"].includes(error?.code);
}

function aborted(signal, error) {
  return Boolean(signal?.aborted || error?.name === "AbortError");
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("Control stopped."), { name: "AbortError" }));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
