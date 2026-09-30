import assert from "node:assert/strict";
import test from "node:test";
import { copySavedText } from "../copy.mjs";
import { osascriptNotification } from "../notify.mjs";
import {
  latestKnownApp,
  parseActionDecision,
  resolveApp,
} from "./actions.mjs";
import { runGoalControl } from "./loop.mjs";

const goal = "Send the Q3 lab invoice to finance";
const apps = [{ app_id: "com.apple.Safari", name: "Safari", pid: 42 }];

function tool(payload, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify({ ok: !isError, ...payload }) }], isError };
}

function sessionTool() {
  const calls = [];
  let observations = 0;
  const callTool = async (name, args) => {
    calls.push(name);
    if (name === "computer_discover") {
      return tool({
        permissions: { accessibility: true, screenRecording: true, ok: true },
        apps,
      });
    }
    if (name === "computer_open_session") return tool({ session_id: "s1", window_title: "Invoice" });
    if (name === "computer_observe") {
      observations += 1;
      return tool({
        observation_id: `obs-${observations}`,
        window_title: "Invoice",
        mode: "control",
        elements: [
          { ref: "e1", role: "AXButton", label: "Send", enabled: true, actions: ["press"] },
          { ref: "e2", role: "AXTextField", label: "Password", subrole: "AXSecureTextField" },
        ],
      });
    }
    if (name === "computer_act") return tool({ status: "dispatched", action: args.action.type });
    if (name === "computer_close_session") return tool({ state: "closed" });
    throw new Error(`unexpected ${name}`);
  };
  return { callTool, calls };
}

function planner(decisions) {
  return {
    async chooseApp() {
      return { ok: true, appId: "com.apple.Safari", appName: "Safari", mode: "control", source: "model" };
    },
    async nextAction() {
      const next = decisions.shift();
      if (!next) return { ok: true, done: true, say: "Done." };
      return next;
    },
  };
}

test("control performs one approved action and then stops when the model is done", async () => {
  const fake = sessionTool();
  const notes = [];
  const result = await runGoalControl({
    goal,
    transcript: "app Safari [com.apple.Safari]",
    callTool: fake.callTool,
    plan: planner([
      { ok: true, done: false, say: "Pressing Send", action: { type: "press", ref: "e1" } },
    ]),
    notify: (message) => notes.push(message),
    includeImage: false,
    maxTurns: 4,
  });
  assert.equal(result.done, true);
  assert.equal(fake.calls.filter((name) => name === "computer_act").length, 1);
  assert.equal(fake.calls.at(-1), "computer_close_session");
  assert.match(notes.join("\n"), /Pressing Send/);
  assert.match(notes.join("\n"), new RegExp(goal));
});

test("an abort before the next action does not act", async () => {
  const fake = sessionTool();
  const controller = new AbortController();
  const result = await runGoalControl({
    goal,
    callTool: fake.callTool,
    plan: {
      async chooseApp() {
        return { ok: true, appId: "com.apple.Safari", appName: "Safari", source: "model" };
      },
      async nextAction({ signal }) {
        controller.abort();
        await new Promise((resolve, reject) => {
          if (signal.aborted) {
            reject(Object.assign(new Error("Control stopped."), { name: "AbortError" }));
            return;
          }
          signal.addEventListener("abort", () => {
            reject(Object.assign(new Error("Control stopped."), { name: "AbortError" }));
          });
        });
      },
    },
    signal: controller.signal,
    announceAbort: true,
    includeImage: false,
  });
  assert.equal(result.reason, "stopped");
  assert.equal(fake.calls.includes("computer_act"), false);
  assert.equal(result.notes.at(-1), "Control stopped.");
});

test("pause and missing permissions do not drive the computer", async () => {
  const paused = sessionTool();
  let checks = 0;
  const pausedResult = await runGoalControl({
    goal,
    callTool: paused.callTool,
    plan: planner([{ ok: true, done: false, action: { type: "press", ref: "e1" } }]),
    isRecording: async () => {
      checks += 1;
      return checks < 2;
    },
    announceAbort: true,
  });
  assert.equal(pausedResult.reason, "paused");
  assert.equal(paused.calls.includes("computer_act"), false);
  assert.match(pausedResult.notes.join(" "), /Control stopped/);

  const blocked = sessionTool();
  const original = blocked.callTool;
  blocked.callTool = async (name, args) => {
    if (name === "computer_discover") {
      return tool({ permissions: { accessibility: false, screenRecording: false }, apps });
    }
    return original(name, args);
  };
  const denied = await runGoalControl({
    goal,
    callTool: blocked.callTool,
    plan: planner([]),
  });
  assert.equal(denied.reason, "permissions");
  assert.equal(denied.notes.some((note) => /will not act/.test(note)), true);
});

test("a declined approval, a pointer click, and a password field stop without repeating work", async () => {
  const declined = sessionTool();
  const original = declined.callTool;
  declined.callTool = async (name, args) => {
    if (name === "computer_open_session") {
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ ok: false, code: "access_denied", message: "The person declined app access." }) }],
      };
    }
    return original(name, args);
  };
  const denial = await runGoalControl({
    goal,
    callTool: declined.callTool,
    plan: planner([]),
  });
  assert.equal(denial.reason, "denied");
  assert.equal(declined.calls.includes("computer_act"), false);

  const pointer = sessionTool();
  const click = await runGoalControl({
    goal,
    callTool: pointer.callTool,
    includeImage: false,
    plan: planner([{ ok: true, done: false, say: "click", action: { type: "click", x: 10, y: 10 } }]),
  });
  assert.equal(click.reason, "pointer");
  assert.equal(pointer.calls.includes("computer_act"), false);

  const secret = sessionTool();
  const password = await runGoalControl({
    goal,
    callTool: secret.callTool,
    plan: planner([{ ok: true, done: false, say: "type password", action: { type: "set_value", ref: "e2", text: "hunter2" } }]),
  });
  assert.equal(password.reason, "password");
  assert.equal(secret.calls.includes("computer_act"), false);
  assert.equal(password.notes.join(" ").includes("hunter2"), false);
});

test("action parsing and app fallback stay concrete", () => {
  const press = parseActionDecision('{"done":false,"say":"Press send","action":{"type":"press","ref":"e1"}}');
  assert.equal(press.ok, true);
  assert.equal(press.action.ref, "e1");
  const click = parseActionDecision('{"done":false,"action":{"type":"click","x":1,"y":2}}');
  assert.equal(click.reason, "pointer");
  const done = parseActionDecision('{"done":true,"say":"The invoice is sent."}');
  assert.equal(done.done, true);

  const fallback = resolveApp({
    parsed: { ok: false },
    apps,
    transcript: "app Mail [com.apple.mail]\napp Safari [com.apple.Safari]",
  });
  assert.equal(fallback.appId, "com.apple.Safari");
  assert.equal(fallback.source, "transcript");
  assert.equal(latestKnownApp("nothing here", apps), null);
});

test("copy refuses a secure field and pastes a saved goal otherwise", async () => {
  let pasted = "";
  const blocked = await copySavedText({
    summary: { goal },
    fieldIsSecure: async () => true,
    writeClipboard: async () => { throw new Error("clipboard"); },
    pasteKeys: async () => { throw new Error("paste"); },
  });
  assert.equal(blocked.reason, "secure-field");

  const copied = await copySavedText({
    summary: { goal },
    fieldIsSecure: async () => false,
    writeClipboard: async (text) => { pasted = text; },
    pasteKeys: async () => {},
  });
  assert.equal(copied.pasted, true);
  assert.equal(pasted, goal);
  assert.match(osascriptNotification("Lately", 'Goal: "quoted"'), /Goal: \\"quoted\\"/);
});
