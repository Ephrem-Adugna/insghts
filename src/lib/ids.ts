export function emailKey(email: string) {
  return email.trim().toLowerCase().replace(/\./g, ",");
}

export function safeId(value: string) {
  return /^[A-Za-z0-9_-]{1,80}$/.test(value);
}

export function channelSlug(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function inviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}
