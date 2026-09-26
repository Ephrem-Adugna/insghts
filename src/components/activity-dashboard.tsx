"use client";

import { useMemo, useState } from "react";
import { format, startOfDay, subDays } from "date-fns";

export type ActivityEvent = {
  id: string;
  uid: string;
  name: string;
  summary: string;
  apps?: string[];
  createdAt: number;
};

type Person = { uid: string; name: string };
type Range = "today" | "week" | "all";

function inRange(createdAt: number, range: Range) {
  if (range === "all") return true;
  const start = range === "today" ? startOfDay(new Date()) : subDays(startOfDay(new Date()), 6);
  return createdAt >= start.getTime();
}

function countApps(events: ActivityEvent[]) {
  const counts = new Map<string, number>();
  for (const event of events) {
    const apps = event.apps?.length ? event.apps : ["Unknown"];
    for (const app of apps) counts.set(app, (counts.get(app) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, 8);
}

function timeBuckets(events: ActivityEvent[], range: Range) {
  if (range === "today") {
    return Array.from({ length: 24 }, (_, hour) => {
      const stamp = new Date();
      stamp.setHours(hour, 0, 0, 0);
      return {
        label: format(stamp, "h a"),
        value: events.filter((event) => new Date(event.createdAt).getHours() === hour).length,
        showLabel: hour % 3 === 0,
      };
    });
  }
  const days = range === "week" ? 7 : 14;
  return Array.from({ length: days }, (_, index) => {
    const day = subDays(startOfDay(new Date()), days - 1 - index);
    const key = format(day, "yyyy-MM-dd");
    return {
      label: format(day, days > 7 ? "M/d" : "EEE"),
      value: events.filter((event) => format(event.createdAt, "yyyy-MM-dd") === key).length,
      showLabel: true,
    };
  });
}

function Columns({ buckets }: { buckets: { label: string; value: number; showLabel: boolean }[] }) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.value));
  return (
    <div className="flex h-40 items-end gap-1">
      {buckets.map((bucket, index) => (
        <div key={`${bucket.label}-${index}`} className="flex h-full min-w-0 flex-1 flex-col justify-end">
          <div className="flex h-full items-end">
            <div
              className="w-full bg-[var(--accent)]"
              style={{ height: bucket.value === 0 ? "0%" : `${Math.max(8, (bucket.value / max) * 100)}%` }}
              title={`${bucket.label}: ${bucket.value}`}
            />
          </div>
          <span className="mt-1 truncate text-center text-[10px] text-[var(--fg-faint)]">
            {bucket.showLabel ? bucket.label : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function Bars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (!rows.length) return <p className="text-[13px] text-[var(--fg-faint)]">Nothing in this range.</p>;
  return (
    <div className="space-y-3">
      {rows.map((row, index) => (
        <div key={`${row.label}-${index}`}>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="truncate">{row.label}</span>
            <span className="text-[var(--fg-faint)]">{row.value}</span>
          </div>
          <div className="mt-1 h-2 bg-[var(--bg-sunken)]">
            <div className="h-2 bg-[var(--fg)]" style={{ width: `${row.value === 0 ? 0 : Math.max(4, (row.value / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ActivityDashboard({
  events,
  people,
  everyone,
}: {
  events: ActivityEvent[];
  people: Person[];
  everyone: boolean;
}) {
  const [range, setRange] = useState<Range>("today");
  const ranged = useMemo(() => events.filter((event) => inRange(event.createdAt, range)), [events, range]);
  const apps = useMemo(() => countApps(ranged), [ranged]);
  const buckets = useMemo(() => timeBuckets(ranged, range), [ranged, range]);
  const byPerson = useMemo(() => {
    const names = new Map(people.map((person) => [person.uid, person.name]));
    for (const event of ranged) {
      if (!names.has(event.uid)) names.set(event.uid, event.name);
    }
    return [...names.entries()]
      .map(([uid, label]) => ({ label, value: ranged.filter((event) => event.uid === uid).length }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  }, [people, ranged]);
  const latest = useMemo(() => {
    const seen = new Map<string, ActivityEvent>();
    for (const event of [...ranged].sort((a, b) => b.createdAt - a.createdAt)) {
      if (everyone) {
        if (!seen.has(event.uid)) seen.set(event.uid, event);
      } else if (seen.size < 5) {
        seen.set(event.id, event);
      }
    }
    return [...seen.values()];
  }, [everyone, ranged]);

  const activePeople = new Set(ranged.map((event) => event.uid)).size;
  const rangeLabel = range === "today" ? "today" : range === "week" ? "in the last 7 days" : "on record";
  const topApp = apps[0];
  const topIsClear = Boolean(topApp && (apps.length === 1 || topApp.value > apps[1].value));
  const lead = ranged.length
    ? `${ranged.length} observation${ranged.length === 1 ? "" : "s"} ${rangeLabel} from ${activePeople} ${activePeople === 1 ? "person" : "people"}.${topIsClear ? ` ${topApp.label} shows up most often.` : ""}`
    : `No observations ${rangeLabel}.`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[15px] leading-6">{lead}</p>
        <label className="flex items-center gap-2 text-[13px] text-[var(--fg-muted)]">
          Range
          <select
            value={range}
            onChange={(event) => setRange(event.target.value as Range)}
            className="border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[var(--fg)]"
          >
            <option value="today">Today</option>
            <option value="week">7 days</option>
            <option value="all">All</option>
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["Observations", ranged.length],
          ["People", activePeople],
          ["Apps", apps.length],
        ].map(([label, value]) => (
          <div key={String(label)} className="border border-[var(--line)] bg-[var(--bg-raised)] px-4 py-3">
            <p className="text-[12px] text-[var(--fg-faint)]">{label}</p>
            <p className="mt-1 text-[28px] font-bold leading-none">{value}</p>
          </div>
        ))}
      </div>
      <section className="border border-[var(--line)] bg-[var(--bg-raised)] p-4">
        <h2 className="text-[14px] font-bold">Observations over time</h2>
        {range === "all" ? <p className="mt-1 text-[12px] text-[var(--fg-faint)]">Last 14 days</p> : null}
        <div className="mt-4">
          <Columns buckets={buckets} />
        </div>
      </section>
      <div className={`grid gap-3 ${everyone ? "lg:grid-cols-2" : ""}`}>
        {everyone ? (
          <section className="border border-[var(--line)] bg-[var(--bg-raised)] p-4">
            <h2 className="text-[14px] font-bold">By person</h2>
            <div className="mt-4">
              <Bars rows={byPerson} />
            </div>
          </section>
        ) : null}
        <section className="border border-[var(--line)] bg-[var(--bg-raised)] p-4">
          <h2 className="text-[14px] font-bold">Apps</h2>
          <div className="mt-4">
            <Bars rows={apps} />
          </div>
        </section>
      </div>
      <section className="border border-[var(--line)] bg-[var(--bg-raised)] p-4">
        <h2 className="text-[14px] font-bold">{everyone ? "Latest from each person" : "Latest observations"}</h2>
        {latest.length === 0 ? (
          <p className="mt-3 text-[13px] text-[var(--fg-faint)]">Nothing in this range.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--line)]">
            {latest.map((event) => (
              <li key={event.id} className="py-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-[14px] font-bold">{event.name}</span>
                  <time className="text-[12px] text-[var(--fg-faint)]">{format(event.createdAt, "MMM d, h:mm a")}</time>
                </div>
                <p className="mt-1 text-[14px] leading-6">{event.summary}</p>
                {event.apps?.length ? <p className="mono mt-1 text-[12px] text-[var(--fg-faint)]">{event.apps.join(" · ")}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
