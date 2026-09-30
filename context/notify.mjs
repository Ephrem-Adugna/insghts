export function osascriptNotification(title, body) {
  const clean = (value) => String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\s+/g, " ").trim();
  return `display notification "${clean(body)}" with title "${clean(title)}"`;
}

export async function notifyMac(body, { title = "Lately", exec = defaultExec } = {}) {
  const text = String(body ?? "").trim();
  if (!text) return { shown: false, reason: "empty" };
  if (process.platform !== "darwin") return { shown: false, reason: "not-mac", text };
  await exec("/usr/bin/osascript", ["-e", osascriptNotification(title, text)]);
  return { shown: true, text };
}

async function defaultExec(command, args) {
  const { spawn } = await import("node:child_process");
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}
