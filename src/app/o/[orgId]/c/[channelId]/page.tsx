"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { onValue, ref } from "firebase/database";
import { format } from "date-fns";
import { Hash } from "lucide-react";
import { api, loadSession } from "@/lib/browser-session";
import { clientDb } from "@/lib/firebase";

type Message = { id: string; uid: string; name: string; body: string; createdAt: number };

export default function ChannelPage() {
  const params = useParams<{ orgId: string; channelId: string }>();
  const { orgId, channelId } = params;
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [me, setMe] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMe(loadSession()?.uid ?? null);
  }, []);

  useEffect(() => {
    const db = clientDb();
    return onValue(ref(db, `orgs/${orgId}/messages/${channelId}`), (snap) => {
      const value = (snap.val() ?? {}) as Record<string, Omit<Message, "id">>;
      const list = Object.entries(value).map(([id, row]) => ({ id, ...row }));
      list.sort((a, b) => a.createdAt - b.createdAt);
      setMessages(list);
    });
  }, [orgId, channelId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (!text) return;
    setSending(true);
    setError("");
    try {
      await api("/api/chat", { method: "POST", body: JSON.stringify({ orgId, channelId, body: text }) });
      setBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send.");
    } finally {
      setSending(false);
    }
  }

  let lastDay = "";

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--line)] px-4">
        <Hash size={16} className="text-[var(--fg-faint)]" />
        <h1 className="text-[16px] font-medium">{channelId}</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <p className="text-[14px] text-[var(--fg-faint)]">This channel is quiet.</p>
        ) : (
          messages.map((message) => {
            const day = format(message.createdAt, "EEEE, MMMM d");
            const showDay = day !== lastDay;
            lastDay = day;
            return (
              <div key={message.id}>
                {showDay ? <p className="my-3 text-center text-[12px] text-[var(--fg-faint)]">{day}</p> : null}
                <article className="mb-3">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[15px] font-medium">{message.name}</span>
                    <time className="text-[12px] text-[var(--fg-faint)]">{format(message.createdAt, "h:mm a")}</time>
                    {message.uid === me ? <span className="text-[12px] text-[var(--fg-faint)]">you</span> : null}
                  </div>
                  <p className="whitespace-pre-wrap text-[15px] leading-6">{message.body}</p>
                </article>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>
      <form onSubmit={send} className="shrink-0 border-t border-[var(--line)] p-3">
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={`Message #${channelId}`}
          rows={2}
          className="w-full resize-none border border-[var(--line)] bg-[var(--bg-raised)] px-3 py-2 outline-none"
        />
        {error ? <p className="mt-2 text-[13px] text-[var(--accent)]">{error}</p> : null}
        <div className="mt-2 flex justify-end">
          <button type="submit" disabled={sending || !body.trim()} className="bg-[var(--fg)] px-3 py-1.5 text-[14px] text-[var(--bg)] disabled:opacity-40">
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
