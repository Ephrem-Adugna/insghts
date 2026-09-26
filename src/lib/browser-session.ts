export type SessionUser = {
  uid: string;
  name: string;
  email: string;
  token: string;
};

const KEY = "insight-session";

export function loadSession(): SessionUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SessionUser;
    if (!parsed.token || !parsed.uid) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(user: SessionUser) {
  localStorage.setItem(KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(KEY);
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const session = loadSession();
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
      ...(init?.headers instanceof Headers
        ? Object.fromEntries(init.headers.entries())
        : (init?.headers as Record<string, string> | undefined)),
    },
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (response.status === 401 && session) {
    clearSession();
    window.location.href = "/login";
    throw new Error("Sign in again.");
  }
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data as T;
}
