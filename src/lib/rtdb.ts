const BASE = "https://insig-55d5d-default-rtdb.firebaseio.com";

export async function dbGet<T>(path: string): Promise<T | null> {
  const response = await fetch(`${BASE}/${path}.json`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Database read failed (${response.status}).`);
  return (await response.json()) as T | null;
}

export async function dbUpdate(patch: Record<string, unknown>) {
  const response = await fetch(`${BASE}/.json`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error(`Database write failed (${response.status}).`);
}
