"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { onValue, ref } from "firebase/database";
import { format } from "date-fns";
import { ActivityDashboard, type ActivityEvent } from "@/components/activity-dashboard";
import { api, loadSession } from "@/lib/browser-session";
import { clientDb } from "@/lib/firebase";

type Person = { uid: string; name: string };

function eventsFromUserNode(uid: string, value: Record<string, Omit<ActivityEvent, "id">>) {
  return Object.entries(value)
    .map(([id, row]) => ({ ...row, id, uid: row.uid || uid }))
    .filter((row) => row.summary);
}

export default function ActivityPage() {
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;
  const [me, setMe] = useState("");
  const [roleReady, setRoleReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [who, setWho] = useState("all");
  const [sort, setSort] = useState<"time" | "person">("time");
  const [tab, setTab] = useState<"dashboard" | "log">("dashboard");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState("");

  useEffect(() => {
    const session = loadSession();
    if (!session) return;
    setMe(session.uid);
    api<{ memberships: { orgId: string; role: string }[] }>("/api/account")
      .then((data) => {
        const membership = data.memberships.find((item) => item.orgId === orgId);
        setIsAdmin(membership?.role === "admin");
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setRoleReady(true));
  }, [orgId]);

  useEffect(() => {
    if (!me || !roleReady) return;
    const db = clientDb();
    const path = isAdmin ? `orgs/${orgId}/activityByUser` : `orgs/${orgId}/activityByUser/${me}`;
    return onValue(ref(db, path), (snap) => {
      const value = snap.val() ?? {};
      if (!isAdmin) {
        setEvents(eventsFromUserNode(me, value).sort((a, b) => a.createdAt - b.createdAt));
        return;
      }
      const list: ActivityEvent[] = [];
      for (const [uid, rows] of Object.entries(value as Record<string, Record<string, Omit<ActivityEvent, "id">>>)) {
        if (!rows || typeof rows !== "object") continue;
        list.push(...eventsFromUserNode(uid, rows));
      }
      setEvents(list);
    });
  }, [isAdmin, me, orgId, roleReady]);

  useEffect(() => {
    if (!isAdmin) return;
    const db = clientDb();
    return onValue(ref(db, `orgs/${orgId}/members`), (snap) => {
      const value = (snap.val() ?? {}) as Record<string, { name?: string }>;
      const list = Object.entries(value).map(([uid, row]) => ({ uid, name: row.name || "Member" }));
      list.sort((a, b) => a.name.localeCompare(b.name));
      setPeople(list);
    });
  }, [isAdmin, orgId]);

  const visible = useMemo(() => {
    const filtered = who === "all" ? events : events.filter((event) => event.uid === who);
    const copy = [...filtered];
    if (isAdmin && sort === "person") {
      copy.sort((a, b) => a.name.localeCompare(b.name) || a.createdAt - b.createdAt);
    } else {
      copy.sort((a, b) => a.createdAt - b.createdAt);
    }
    return copy;
  }, [events, isAdmin, sort, who]);

  async function remove(event: ActivityEvent) {
    setRemoving(event.id);
    setError("");
    setEvents((current) => current.filter((item) => item.id !== event.id));
    try {
      await api("/api/activity", {
        method: "DELETE",
        body: JSON.stringify({ orgId, ownerId: event.uid, eventId: event.id }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that activity.");
    } finally {
      setRemoving("");
    }
  }

  const selectedName = people.find((person) => person.uid === who)?.name;
  const showDashboard = isAdmin && tab === "dashboard";

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-[var(--line)] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[16px] font-bold">Activity</h1>
          {isAdmin ? (
            <label className="flex items-center gap-2 text-[13px] text-[var(--fg-muted)]">
              Show
              <select
                value={who}
                onChange={(event) => setWho(event.target.value)}
                className="border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[var(--fg)]"
              >
                <option value="all">Everyone</option>
                {people.map((person) => (
                  <option key={person.uid} value={person.uid}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {isAdmin ? (
          <div className="mt-3 flex gap-4 text-[14px]">
            <button
              type="button"
              className={tab === "dashboard" ? "border-b-2 border-[var(--fg)] pb-1 font-bold" : "pb-1 text-[var(--fg-faint)]"}
              onClick={() => setTab("dashboard")}
            >
              Dashboard
            </button>
            <button
              type="button"
              className={tab === "log" ? "border-b-2 border-[var(--fg)] pb-1 font-bold" : "pb-1 text-[var(--fg-faint)]"}
              onClick={() => setTab("log")}
            >
              Activity
            </button>
          </div>
        ) : (
          <p className="mt-1 max-w-2xl text-[13px] text-[var(--fg-muted)]">
            You only see your own observations. Remove any you do not want kept.
          </p>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {!roleReady ? <p className="text-[14px] text-[var(--fg-faint)]">Opening activity…</p> : null}
        {error ? <p className="mb-3 text-[13px] text-[var(--accent)]">{error}</p> : null}
        {roleReady && showDashboard ? (
          <ActivityDashboard events={visible} people={people} everyone={who === "all"} />
        ) : null}
        {roleReady && !showDashboard ? (
          <>
            {isAdmin ? (
              <div className="mb-4 flex justify-end">
                <label className="flex items-center gap-2 text-[13px] text-[var(--fg-muted)]">
                  Sort
                  <select
                    value={sort}
                    onChange={(event) => setSort(event.target.value as "time" | "person")}
                    className="border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[var(--fg)]"
                  >
                    <option value="time">By time</option>
                    <option value="person">By person</option>
                  </select>
                </label>
              </div>
            ) : null}
            {visible.length === 0 ? (
              <p className="text-[14px] text-[var(--fg-faint)]">
                {who !== "all" && selectedName
                  ? `No activity from ${selectedName}.`
                  : "Nothing observed yet. Leave Insight open on this computer while Screenpipe is running."}
              </p>
            ) : (
              visible.map((event) => (
                <article key={event.id} className="mb-4 border-b border-[var(--line)] pb-4">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[15px] font-bold">{event.name}</span>
                    <time className="text-[12px] text-[var(--fg-faint)]">{format(event.createdAt, "h:mm a")}</time>
                    <button
                      type="button"
                      className="ml-auto text-[12px] text-[var(--fg-faint)] hover:text-[var(--accent)]"
                      disabled={removing === event.id}
                      onClick={() => remove(event)}
                    >
                      {removing === event.id ? "Removing…" : "Remove"}
                    </button>
                  </div>
                  <p className="mt-1 text-[15px] leading-6">{event.summary}</p>
                  {event.apps?.length ? (
                    <p className="mono mt-1 text-[12px] text-[var(--fg-faint)]">{event.apps.join(" · ")}</p>
                  ) : null}
                </article>
              ))
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}
