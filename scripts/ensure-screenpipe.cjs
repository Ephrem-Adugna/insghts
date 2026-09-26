#!/usr/bin/env node
/**
 * Start Screenpipe if it is not already listening, then stay alive so
 * Insight and observation share one process tree (`npm run desktop`).
 */
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ENDPOINT = process.env.SCREENPIPE_ENDPOINT || "http://localhost:3030";
const HOLD = process.argv.includes("--hold");

async function healthy() {
  try {
    const response = await fetch(`${ENDPOINT.replace(/\/$/, "")}/health`, {
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

function startRecorder() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "insight-screenpipe-"));
  const child = spawn(
    "npx",
    [
      "-y",
      "screenpipe@latest",
      "record",
      "--port",
      "3030",
      "--disable-telemetry",
      "--use-all-monitors",
      "true",
      "--idle-capture-interval-ms",
      "2000",
    ],
    {
      cwd,
      env: { ...process.env },
      stdio: HOLD ? "inherit" : "ignore",
      detached: !HOLD,
    },
  );
  if (!HOLD) child.unref();
  return child;
}

async function waitUntilUp(ms = 90_000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (await healthy()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function main() {
  if (await healthy()) {
    console.log("Screenpipe is already observing on", ENDPOINT);
  } else {
    console.log("Starting Screenpipe alongside Insight…");
    startRecorder();
    const up = await waitUntilUp();
    if (!up) {
      console.error("Screenpipe did not become healthy at", ENDPOINT);
      process.exit(1);
    }
    console.log("Screenpipe is observing on", ENDPOINT);
  }

  if (HOLD) {
    process.stdin.resume();
    const stay = setInterval(() => {}, 60_000);
    const stop = () => {
      clearInterval(stay);
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
