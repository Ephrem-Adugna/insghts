"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { loadSession } from "@/lib/browser-session";

export default function HomePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(loadSession() ? "/start" : "/login");
  }, [router]);
  return <main className="p-8 text-[var(--fg-faint)]">Opening Insight…</main>;
}
