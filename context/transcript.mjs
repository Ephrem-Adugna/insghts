const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const KEY_RE = /\b(?:sk-|ghp_|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/g;
const CARD_RE = /\b(?:\d[ -]*?){13,19}\b/g;

export function redact(text) {
  return String(text ?? "")
    .replace(EMAIL_RE, "[email]")
    .replace(SSN_RE, "[ssn]")
    .replace(KEY_RE, "[secret]")
    .replace(CARD_RE, "[card]");
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(Math.round(parsed)) : "?";
}

export function formatEvent(event) {
  if (!event || typeof event !== "object") return "";
  const ts = event.ts ? `${event.ts} ` : "";
  switch (event.type) {
    case "pointer":
      return `${ts}pointer ${num(event.x)},${num(event.y)}`;
    case "click":
      return `${ts}click ${event.button || "left"} ${num(event.x)},${num(event.y)}`;
    case "scroll":
      return `${ts}scroll ${num(event.x)},${num(event.y)}`;
    case "key":
      if (event.hidden) return `${ts}key hidden (secure field)`;
      return `${ts}key ${event.key || "unknown"}`;
    case "text":
      if (event.hidden || event.reason === "password") return `${ts}text hidden (password field)`;
      if (event.op === "deleted") {
        const body = event.text ? redact(event.text) : `${event.count || 1} characters`;
        return `${ts}deleted ${body}`;
      }
      return `${ts}typed ${redact(event.text || "")}`;
    case "clipboard":
      if (event.hidden || event.reason === "password") return `${ts}clipboard hidden (password field)`;
      return `${ts}clipboard ${redact(event.text || "").slice(0, 200)}`;
    case "frontmost": {
      const id = event.bundleId ? ` [${event.bundleId}]` : "";
      return `${ts}app ${event.app || "unknown"}${id}`;
    }
    case "window":
      return `${ts}window ${event.app || "unknown"} — ${redact(event.title || "")}`;
    case "url":
      return `${ts}url ${event.app || ""} ${event.url || ""}`.trim();
    case "file":
      return `${ts}file ${event.path || ""}`;
    default:
      return "";
  }
}

export function transcriptFromEvents(events, { maxChars = 12000 } = {}) {
  const lines = [];
  for (const event of events || []) {
    const line = formatEvent(event);
    if (line) lines.push(line);
  }
  let text = lines.join("\n");
  if (text.length > maxChars) {
    text = text.slice(text.length - maxChars);
    const cut = text.indexOf("\n");
    if (cut !== -1) text = text.slice(cut + 1);
  }
  return text.trim();
}
