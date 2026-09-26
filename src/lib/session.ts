import { createHmac, timingSafeEqual } from "crypto";

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set.");
  return value;
}

export function signSession(uid: string) {
  const body = Buffer.from(
    JSON.stringify({ uid, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 }),
  ).toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readSessionToken(token: string) {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as {
      uid?: string;
      exp?: number;
    };
    if (!payload.uid || !payload.exp || payload.exp < Date.now()) return null;
    return payload.uid;
  } catch {
    return null;
  }
}
