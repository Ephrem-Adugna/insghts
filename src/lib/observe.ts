const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const KEY_RE = /\b(?:sk-|ghp_|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/g;
const CARD_RE = /\b(?:\d[ -]*?){13,19}\b/g;

type Row = {
  ts: number;
  app: string;
  window: string;
  text: string;
};

type Segment = Row & { end: number; count: number };

function redact(text: string) {
  return text.replace(EMAIL_RE, "[email]").replace(SSN_RE, "[ssn]").replace(KEY_RE, "[secret]").replace(CARD_RE, "[card]");
}

function clip(text: string, max = 180) {
  const flat = redact(text).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function firstString(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function parseTs(value: unknown) {
  if (typeof value === "number") return value > 1e12 ? value : value * 1000;
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

function normalize(item: unknown): Row | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  const content =
    record.content && typeof record.content === "object" ? (record.content as Record<string, unknown>) : {};
  const text = firstString(content, ["text", "transcription", "description", "text_content"]);
  const app = firstString(content, ["app_name", "app"]);
  const window = firstString(content, ["window_name", "window_title", "window"]);
  const eventType = firstString(content, ["event_type", "name"]);
  const line = text || (eventType ? eventType : "");
  if (!app && !window && !line) return null;
  return {
    ts: parseTs(content.timestamp ?? record.timestamp),
    app: app || "unknown",
    window,
    text: clip(line),
  };
}

function similar(a: string, b: string) {
  if (a === b) return true;
  if (a.length < 40 || b.length < 40) return false;
  const [left, right] = a.length < b.length ? [a, b] : [b, a];
  return right.includes(left);
}

export function buildTimeline(items: unknown[]) {
  const rows = items
    .map(normalize)
    .filter((row): row is Row => Boolean(row))
    .sort((a, b) => a.ts - b.ts);
  const segments: Segment[] = [];
  for (const row of rows) {
    const prev = segments[segments.length - 1];
    if (prev && prev.app === row.app && prev.window === row.window && similar(prev.text, row.text)) {
      prev.end = row.ts;
      prev.count += 1;
      if (row.text.length > prev.text.length) prev.text = row.text;
      continue;
    }
    segments.push({ ...row, end: row.ts, count: 1 });
  }
  const apps: string[] = [];
  for (const segment of segments) {
    if (!apps.includes(segment.app)) apps.push(segment.app);
  }
  const lines = segments.slice(-12).map((segment) => {
    const title = segment.window ? ` — ${segment.window}` : "";
    const repeat = segment.count > 1 ? ` (x${segment.count})` : "";
    const body = segment.text ? `\n    ${segment.text}` : "";
    return `[${segment.app}${title}]${repeat}${body}`;
  });
  return {
    apps: apps.slice(0, 8),
    text: lines.join("\n").slice(0, 3500),
    count: rows.length,
  };
}

async function screenpipeItems() {
  const base = (process.env.SCREENPIPE_ENDPOINT || "http://127.0.0.1:3030").replace(/\/$/, "");
  const key = process.env.SCREENPIPE_LOCAL_API_KEY;
  const headers: Record<string, string> = {};
  if (key) headers.Authorization = `Bearer ${key}`;
  const health = await fetch(`${base}/health`, { cache: "no-store" }).catch(() => null);
  if (!health?.ok) throw new Error("Screenpipe is not running on this computer.");
  const end = new Date();
  const start = new Date(end.getTime() - 2 * 60 * 1000);
  const collected: unknown[] = [];
  const seen = new Set<string>();
  for (const contentType of ["accessibility", "input", "ocr"]) {
    const url = new URL("/search", base);
    url.searchParams.set("content_type", contentType);
    url.searchParams.set("limit", "25");
    url.searchParams.set("start_time", start.toISOString());
    url.searchParams.set("end_time", end.toISOString());
    const response = await fetch(url, { headers, cache: "no-store" });
    if (response.status === 403) throw new Error("Screenpipe rejected the local API key.");
    if (!response.ok) throw new Error(`Screenpipe search failed (${response.status}).`);
    const payload = (await response.json()) as { data?: unknown[] } | unknown[];
    const items = Array.isArray(payload) ? payload : payload.data;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const key = JSON.stringify(item).slice(0, 180);
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(item);
    }
  }
  return collected;
}

function cleanSummary(raw: string) {
  const compact = raw.replace(/\s+/g, " ").trim().replace(/^(summary|observation|answer)\s*:\s*/i, "");
  const sentences = compact.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [compact];
  const echo = /these directions|one person's computer|the notes below|redacted|screenpipe/i;
  const kept = sentences.map((sentence) => sentence.trim()).filter((sentence) => sentence && !echo.test(sentence));
  const chosen = (kept.length ? kept : sentences).slice(0, 2).join(" ").trim();
  return chosen.slice(0, 400);
}

async function summarize(timeline: string) {
  const host = (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = process.env.OLLAMA_MODEL || "qwen2.5:0.5b";
  const prompt = `Notes from a computer screen:\n${timeline}\n\nOne or two sentences about what the person is doing. Start with the person's action. Do not repeat these directions.\nAnswer:`;
  const response = await fetch(`${host}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: 0.2, num_predict: 80, num_ctx: 2048 },
    }),
    signal: AbortSignal.timeout(40000),
  }).catch(() => null);
  if (!response?.ok) throw new Error(`Local model ${model} is not running in Ollama.`);
  const payload = (await response.json()) as { response?: string };
  return cleanSummary(payload.response || "");
}

export async function observeScreen() {
  const items = await screenpipeItems();
  const timeline = buildTimeline(items);
  if (!timeline.text) return { skipped: "empty" as const, summary: "", apps: [] as string[] };
  const summary = await summarize(timeline.text);
  if (!summary) return { skipped: "empty" as const, summary: "", apps: timeline.apps };
  return { skipped: null, summary, apps: timeline.apps };
}
