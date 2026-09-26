"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, loadSession } from "@/lib/browser-session";

type Membership = { orgId: string; orgName: string; role: string };

export default function StartPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [orgName, setOrgName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");

  useEffect(() => {
    if (!loadSession()) {
      router.replace("/login");
      return;
    }
    const pick = new URLSearchParams(window.location.search).get("pick") === "1";
    api<{ memberships: Membership[] }>("/api/account")
      .then((data) => {
        setMemberships(data.memberships);
        if (!pick && data.memberships.length === 1) {
          router.replace(`/o/${data.memberships[0].orgId}/c/general`);
          return;
        }
        setReady(true);
      })
      .catch((err: Error) => {
        setError(err.message);
        setReady(true);
      });
  }, [router]);

  async function createOrg(event: FormEvent) {
    event.preventDefault();
    setPending("create");
    setError("");
    try {
      const result = await api<{ orgId: string }>("/api/orgs", {
        method: "POST",
        body: JSON.stringify({ name: orgName }),
      });
      router.push(`/o/${result.orgId}/c/general`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the organization.");
      setPending("");
    }
  }

  async function joinOrg(event: FormEvent) {
    event.preventDefault();
    setPending("join");
    setError("");
    try {
      const result = await api<{ orgId: string }>("/api/orgs/join", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      router.push(`/o/${result.orgId}/c/general`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join.");
      setPending("");
    }
  }

  if (!ready) {
    return <main className="p-8 text-[var(--fg-faint)]">Opening your organizations…</main>;
  }

  return (
    <main className="min-h-screen bg-[var(--bg)] px-6 py-16 text-[var(--fg)]">
      <div className="mx-auto max-w-3xl">
        <p className="text-[40px] font-black leading-none">Start a lab, or join one</p>
        <p className="mt-3 max-w-xl text-[15px] text-[var(--fg-muted)]">
          Channels and activity live in your organization. A new lab begins with #general and an invite code.
        </p>
        {memberships.length ? (
          <ul className="mt-8 border border-[var(--line)]">
            {memberships.map((org) => (
              <li key={org.orgId} className="border-b border-[var(--line)] last:border-b-0">
                <button
                  type="button"
                  onClick={() => router.push(`/o/${org.orgId}/c/general`)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-[var(--bg-sunken)]"
                >
                  <span>{org.orgName}</span>
                  <span className="text-[13px] text-[var(--fg-faint)]">{org.role}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <form onSubmit={createOrg} className="border border-[var(--line)] bg-[var(--bg-raised)] p-5">
            <h2 className="text-[16px]">Create an organization</h2>
            <input
              value={orgName}
              onChange={(event) => setOrgName(event.target.value)}
              placeholder="Laboratory name"
              className="mt-4 w-full border border-[var(--line)] bg-[var(--bg)] px-3 py-2 outline-none"
              required
            />
            <button type="submit" disabled={pending === "create"} className="mt-4 bg-[var(--fg)] px-4 py-2 text-[var(--bg)]">
              {pending === "create" ? "Creating…" : "Create"}
            </button>
          </form>
          <form onSubmit={joinOrg} className="border border-[var(--line)] bg-[var(--bg-raised)] p-5">
            <h2 className="text-[16px]">Join with a code</h2>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="AB12CD"
              className="mono mt-4 w-full border border-[var(--line)] bg-[var(--bg)] px-3 py-2 uppercase outline-none"
              required
              maxLength={6}
            />
            <button type="submit" disabled={pending === "join"} className="mt-4 bg-[var(--fg)] px-4 py-2 text-[var(--bg)]">
              {pending === "join" ? "Joining…" : "Join"}
            </button>
          </form>
        </div>
        {error ? <p className="mt-4 text-[14px] text-[var(--accent)]">{error}</p> : null}
      </div>
    </main>
  );
}
