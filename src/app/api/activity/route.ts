import { NextResponse } from "next/server";
import { currentUser, requireMember, unauthorized } from "@/lib/account";
import { safeId } from "@/lib/ids";
import { dbGet, dbUpdate } from "@/lib/rtdb";

export const dynamic = "force-dynamic";

type ActivityEvent = { summary?: string; uid?: string };

export async function DELETE(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthorized();
  const body = (await request.json().catch(() => null)) as {
    orgId?: string;
    ownerId?: string;
    eventId?: string;
  } | null;
  const orgId = body?.orgId ?? "";
  const ownerId = body?.ownerId ?? "";
  const eventId = body?.eventId ?? "";
  if (!safeId(orgId) || !safeId(ownerId) || !safeId(eventId)) {
    return NextResponse.json({ error: "Unknown activity." }, { status: 400 });
  }
  const member = await requireMember(user.uid, orgId);
  if (!member) return NextResponse.json({ error: "You are not in this organization." }, { status: 403 });
  const event = await dbGet<ActivityEvent>(`orgs/${orgId}/activityByUser/${ownerId}/${eventId}`);
  if (!event) return NextResponse.json({ error: "That activity is already gone." }, { status: 404 });
  const latest = await dbGet<{ summary?: string }>(`orgs/${orgId}/activityLatest/${ownerId}`);
  const patch: Record<string, null> = {
    [`orgs/${orgId}/activityByUser/${ownerId}/${eventId}`]: null,
  };
  if (latest?.summary && latest.summary === event.summary) {
    patch[`orgs/${orgId}/activityLatest/${ownerId}`] = null;
  }
  await dbUpdate(patch);
  return NextResponse.json({ ok: true });
}
