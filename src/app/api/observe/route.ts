import { NextResponse } from "next/server";
import { currentUser, requireMember, unauthorized } from "@/lib/account";
import { safeId } from "@/lib/ids";
import { observeScreen } from "@/lib/observe";
import { dbGet, dbUpdate } from "@/lib/rtdb";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthorized();
  if (!user.observing) return NextResponse.json({ ok: true, skipped: "paused", summary: "", apps: [] });
  const body = (await request.json().catch(() => null)) as { orgId?: string } | null;
  const orgId = body?.orgId ?? "";
  if (!safeId(orgId)) return NextResponse.json({ error: "Unknown organization." }, { status: 400 });
  const member = await requireMember(user.uid, orgId);
  if (!member) return NextResponse.json({ error: "You are not in this organization." }, { status: 403 });
  try {
    const observation = await observeScreen();
    if (!observation.summary) {
      return NextResponse.json({ ok: true, skipped: observation.skipped ?? "empty", summary: "", apps: [] });
    }
    const previous = await dbGet<{ summary?: string }>(`orgs/${orgId}/activityLatest/${user.uid}`);
    if (previous?.summary === observation.summary) {
      return NextResponse.json({ ok: true, skipped: "duplicate", summary: observation.summary, apps: observation.apps });
    }
    const eventId = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    await dbUpdate({
      [`orgs/${orgId}/activityByUser/${user.uid}/${eventId}`]: {
        uid: user.uid,
        name: user.name,
        summary: observation.summary,
        apps: observation.apps,
        createdAt: Date.now(),
      },
      [`orgs/${orgId}/activityLatest/${user.uid}`]: { summary: observation.summary, at: Date.now() },
    });
    return NextResponse.json({ ok: true, skipped: null, summary: observation.summary, apps: observation.apps });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Observation failed.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
