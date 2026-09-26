"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { api, saveSession } from "@/lib/browser-session";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const path = mode === "register" ? "/api/register" : "/api/login";
      const result = await api<{ token: string; user: { uid: string; name: string; email: string } }>(path, {
        method: "POST",
        body: JSON.stringify({ name, email, password }),
      });
      saveSession({ ...result.user, token: result.token });
      router.push("/start");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not continue.");
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-6 text-[var(--fg)]">
      <form onSubmit={onSubmit} className="w-full max-w-md border border-[var(--line)] bg-[var(--bg-raised)] p-8">
        <p className="text-[34px] font-black leading-none">Insight</p>
        <p className="mt-3 text-[15px] text-[var(--fg-muted)]">
          {mode === "register" ? "Create an account, then start or join a lab." : "Sign in to your lab."}
        </p>
        <div className="mt-8 space-y-4">
          {mode === "register" ? (
            <label className="block text-[13px] text-[var(--fg-muted)]">
              Name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1 w-full border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[15px] text-[var(--fg)] outline-none"
                autoComplete="name"
                required
              />
            </label>
          ) : null}
          <label className="block text-[13px] text-[var(--fg-muted)]">
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[15px] text-[var(--fg)] outline-none"
              autoComplete="email"
              required
            />
          </label>
          <label className="block text-[13px] text-[var(--fg-muted)]">
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[15px] text-[var(--fg)] outline-none"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              required
              minLength={8}
            />
          </label>
        </div>
        {error ? <p className="mt-4 text-[14px] text-[var(--accent)]">{error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="mt-6 w-full bg-[var(--fg)] px-4 py-2 text-[15px] text-[var(--bg)] disabled:opacity-60"
        >
          {pending ? "Working…" : mode === "register" ? "Create account" : "Sign in"}
        </button>
        <p className="mt-6 text-[14px] text-[var(--fg-muted)]">
          {mode === "register" ? (
            <Link href="/login">Already have an account</Link>
          ) : (
            <Link href="/register">Create an account</Link>
          )}
        </p>
      </form>
    </main>
  );
}
