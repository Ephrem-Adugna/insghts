import { spawn } from "node:child_process";
import { isDirectRun } from "./direct.mjs";
import { latelyFiles, supportDir } from "./paths.mjs";
import { readJson } from "./store.mjs";

export async function copySavedText({ summary, fieldIsSecure, writeClipboard, pasteKeys }) {
  const text = typeof summary?.goal === "string" ? summary.goal : typeof summary?.text === "string" ? summary.text : "";
  if (!text.trim()) return { pasted: false, reason: "empty" };
  if (await fieldIsSecure()) return { pasted: false, reason: "secure-field" };
  await writeClipboard(text);
  await pasteKeys();
  return { pasted: true, text };
}

export async function focusedFieldIsSecure({ exec = defaultExec } = {}) {
  const script = `
tell application "System Events"
  set frontProc to first application process whose frontmost is true
  try
    set focusedEl to value of attribute "AXFocusedUIElement" of frontProc
    set roleName to ""
    set subName to ""
    try
      set roleName to value of attribute "AXSubrole" of focusedEl
    end try
    try
      set subName to value of attribute "AXRoleDescription" of focusedEl
    end try
    if roleName is "AXSecureTextField" then return "secure"
    if subName contains "password" then return "secure"
  end try
end tell
return "clear"
`;
  try {
    const output = await exec("/usr/bin/osascript", ["-e", script]);
    return String(output).toLowerCase().includes("secure");
  } catch {
    return true;
  }
}

async function defaultExec(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve(out) : reject(new Error(`${command} exited ${code}`))));
  });
}

async function main() {
  const files = latelyFiles(supportDir());
  const summary = await readJson(files.summary, null);
  const result = await copySavedText({
    summary,
    fieldIsSecure: () => focusedFieldIsSecure(),
    writeClipboard: async (text) => {
      await new Promise((resolve, reject) => {
        const child = spawn("/usr/bin/pbcopy", { stdio: ["pipe", "ignore", "ignore"] });
        child.on("error", reject);
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("pbcopy failed"))));
        child.stdin.end(text);
      });
    },
    pasteKeys: async () => {
      await defaultExec("/usr/bin/osascript", ["-e", 'tell application "System Events" to keystroke "v" using command down']);
    },
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.pasted) process.exitCode = 1;
}

if (isDirectRun(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
