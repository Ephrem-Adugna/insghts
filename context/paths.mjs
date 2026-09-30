import { homedir } from "node:os";
import { join } from "node:path";

export function supportDir(env = process.env, home = homedir()) {
  if (env.LATELY_SUPPORT_DIR) return env.LATELY_SUPPORT_DIR;
  return join(home, "Library", "Application Support", "Lately");
}

export function latelyFiles(dir = supportDir()) {
  return {
    dir,
    events: join(dir, "events.jsonl"),
    summary: join(dir, "summary.json"),
    recording: join(dir, "recording.json"),
    control: join(dir, "control.json"),
    stop: join(dir, "stop.request"),
    lock: join(dir, "ollama.lock"),
    status: join(dir, "goal-status.json"),
    log: join(dir, "control.log"),
  };
}
