#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(root, "context/.build");
const app = join(buildDir, "Lately.app");
const macos = join(app, "Contents/MacOS");
const binary = join(macos, "Lately");
const source = join(root, "context/ContextBar.swift");
const plist = join(root, "context/Info.plist");
const helperPkg = join(root, "context/openwork/computer-use/native");
const helperBin = join(helperPkg, ".build/release/ComputerUse");

if (process.platform !== "darwin") {
  console.error("Lately is a macOS menu-bar app. This machine cannot compile or launch it.");
  console.error("On a Mac, from the Insight repo: npm run lately");
  process.exit(1);
}

mkdirSync(macos, { recursive: true });
writeFileSync(join(app, "Contents/Info.plist"), readFileSync(plist));
writeFileSync(join(buildDir, "lately.env"), `LATELY_ROOT=${root}\nLATELY_NODE=${process.execPath}\n`);

if (needsRebuild(helperBin, [helperPkg])) {
  const built = spawnSync("swift", [
    "build", "-c", "release", "--package-path", helperPkg, "--product", "ComputerUse",
  ], { stdio: "inherit" });
  if (built.status !== 0) {
    console.error("Could not build the OpenWork Computer Use helper.");
    process.exit(built.status || 1);
  }
}

if (needsRebuild(binary, [source])) {
  const compiled = spawnSync("swiftc", [
    "-O",
    "-framework", "AppKit",
    "-framework", "ApplicationServices",
    "-framework", "Carbon",
    "-o", binary,
    source,
  ], { stdio: "inherit" });
  if (compiled.status !== 0) {
    console.error("Could not compile Lately.");
    process.exit(compiled.status || 1);
  }
}

console.log("Lately needs Accessibility (listen-only event tap), Screen Recording, and Automation.");
console.log("Those are listed in the menu bar item. Password fields stay hidden. Raw events stay on this Mac.");
console.log("Computer control shows an approval dialog and the OpenWork panel. Control-Option-C starts it after a goal notification, and the same shortcut stops it.");

const child = spawn(binary, [], {
  detached: true,
  stdio: "ignore",
  env: {
    ...process.env,
    LATELY_ROOT: root,
    LATELY_NODE: process.execPath,
  },
});
child.unref();

function needsRebuild(output, inputs) {
  if (!existsSync(output)) return true;
  const built = statSync(output).mtimeMs;
  return newest(inputs) > built;
}

function newest(inputs) {
  let max = 0;
  for (const input of inputs) {
    const info = statSync(input);
    if (info.isDirectory()) {
      for (const entry of readdirSync(input)) {
        if (entry === ".build" || entry === ".swiftpm") continue;
        max = Math.max(max, newest([join(input, entry)]));
      }
    } else if (/\.(swift|plist|mjs)$/.test(input)) {
      max = Math.max(max, info.mtimeMs);
    }
  }
  return max;
}
