"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { onValue, ref } from "firebase/database";
import { Activity, Hash, Plus } from "lucide-react";
import { ThemeToggle } from "@/components/theme";
import { api, clearSession, loadSession } from "@/lib/browser-session";
import { clientDb } from "@/lib/firebase";

type Channel = { id: string; name: string };
type Account = {
  user: { uid: string; name: string; email: string; observing: boolean };
  memberships: { orgId: string; orgName: string; role: string }[];
};

export default function OrgLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;
  const pathname = usePathname();
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [orgName, setOrgName] = useState("");
  const [invite, setInvite] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [adding, setAdding] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [status, setStatus] = useState("Starting observation…");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loadSession()) {
      router.replace("/login");
      return;
    }
    let stop = false;
    api<Account>("/api/account")
      .then((data) => {
        if (stop) return;
        if (!data.memberships.some((item) => item.orgId === orgId)) {
          router.replace("/start?pick=1");
          return;
        }
        setAccount(data);
        setStatus(data.user.observing ? "Starting observation…" : "Observation paused");
      })
      .catch((err: Error) => setError(err.message));
    return () => {
      stop = true;
    };
  }, [orgId, router]);

  useEffect(() => {
    const db = clientDb();
    const unsubName = onValue(ref(db, `orgs/${orgId}/name`), (snap) => setOrgName(String(snap.val() ?? "")));
    const unsubInvite = onValue(ref(db, `orgs/${orgId}/inviteCode`), (snap) => setInvite(String(snap.val() ?? "")));
    const unsubChannels = onValue(ref(db, `orgs/${orgId}/channels`), (snap) => {
      const value = (snap.val() ?? {}) as Record<string, { name?: string }>;
      const list = Object.entries(value).map(([id, row]) => ({ id, name: row.name || id }));
      list.sort((a, b) => a.name.localeCompare(b.name));
      setChannels(list);
    });
    return () => {
      unsubName();
      unsubInvite();
      unsubChannels();
    };
  }, [orgId]);

  useEffect(() => {
    if (!account?.user.observing) return;
    let cancel = false;
    async function run() {
      setStatus("Reading the screen…");
      try {
        const result = await api<{ summary?: string; skipped?: string | null; error?: string }>("/api/observe", {
          method: "POST",
          body: JSON.stringify({ orgId }),
        });
        if (cancel) return;
        if (result.summary) setStatus("Observing");
        else if (result.skipped === "empty") setStatus("Observing · waiting for screen text");
        else setStatus("Observing");
      } catch (err) {
        if (!cancel) setStatus(err instanceof Error ? err.message : "Observation failed");
      }
    }
    void run();
    const timer = window.setInterval(run, 40000);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, [account?.user.observing, orgId]);

  async function createChannel(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const result = await api<{ channelId: string }>("/api/channels", {
        method: "POST",
        body: JSON.stringify({ orgId, name: channelName }),
      });
      setChannelName("");
      setAdding(false);
      router.push(`/o/${orgId}/c/${result.channelId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the channel.");
    }
  }

  async function toggleObserving() {
    if (!account) return;
    const observing = !account.user.observing;
    const result = await api<{ user: Account["user"] }>("/api/account", {
      method: "PATCH",
      body: JSON.stringify({ observing }),
    });
    setAccount({ ...account, user: result.user });
    setStatus(observing ? "Starting observation…" : "Observation paused");
  }

  if (!account) {
    return <main className="p-8 text-[var(--fg-faint)]">{error || "Opening the organization…"}</main>;
  }

  const activityActive = pathname.endsWith("/activity");

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg)] text-[var(--fg)]">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-[var(--line)] bg-[var(--bg-raised)] px-3">
        <Link href="/start?pick=1" className="px-2 text-[15px] font-medium no-underline">
          {orgName || "Organization"}
        </Link>
        <button
          type="button"
          className="mono text-[12px] text-[var(--fg-faint)]"
          onClick={() => navigator.clipboard.writeText(invite)}
          title="Copy invite code"
        >
          Invite {invite}
        </button>
        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle />
          <button
            type="button"
            className="text-[13px] text-[var(--fg-faint)]"
            onClick={() => {
              clearSession();
              router.push("/login");
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[260px] shrink-0 flex-col border-r border-[var(--line)] bg-[var(--bg-raised)]">
          <nav className="flex-1 overflow-y-auto px-2 py-3">
            <Link
              href={`/o/${orgId}/activity`}
              className={`flex items-center gap-2 rounded-md px-2 py-1 no-underline ${
                activityActive ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--bg-sunken)]"
              }`}
            >
              <Activity size={15} />
              Activity
            </Link>
            <div className="mb-1 mt-4 flex items-center justify-between px-2 text-[13px] text-[var(--fg-faint)]">
              <span>Channels</span>
              <button type="button" onClick={() => setAdding((value) => !value)} aria-label="New channel">
                <Plus size={14} />
              </button>
            </div>
            {adding ? (
              <form onSubmit={createChannel} className="mb-2 flex gap-1 px-2">
                <input
                  value={channelName}
                  onChange={(event) => setChannelName(event.target.value)}
                  placeholder="channel-name"
                  className="min-w-0 flex-1 border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[14px] outline-none"
                  autoFocus
                />
                <button type="submit" className="border border-[var(--line)] px-2 text-[13px]">
                  Add
                </button>
              </form>
            ) : null}
            {channels.map((channel) => {
              const href = `/o/${orgId}/c/${channel.id}`;
              const active = pathname === href;
              return (
                <Link
                  key={channel.id}
                  href={href}
                  className={`flex items-center gap-2 rounded-md px-2 py-1 no-underline ${
                    active ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--bg-sunken)]"
                  }`}
                >
                  <Hash size={14} className="text-[var(--fg-faint)]" />
                  {channel.name}
                </Link>
              );
            })}
            {error ? <p className="px-2 pt-3 text-[12px] text-[var(--accent)]">{error}</p> : null}
          </nav>
          <div className="border-t border-[var(--line)] px-3 pb-14 pt-3 text-[13px]">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${status.startsWith("Observ") ? "bg-[var(--online)]" : "bg-[var(--warn)]"}`} />
              <span className="text-[var(--fg-faint)]">{status}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="truncate">{account.user.name}</span>
              <button type="button" className="shrink-0 text-[var(--fg-faint)]" onClick={toggleObserving}>
                {account.user.observing ? "Pause" : "Resume"}
              </button>
            </div>
          </div>
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
