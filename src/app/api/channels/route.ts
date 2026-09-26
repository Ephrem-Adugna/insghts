import { NextResponse } from "next/server";
import { currentUser, requireMember, unauthorized } from "@/lib/account";
import { channelSlug, safeId } from "@/lib/ids";
import { dbGet, dbUpdate } from "@/lib/rtdb";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthorized();
  const body = (await request.json().catch(() => null)) as { orgId?: string; name?: string } | null;
  const orgId = body?.orgId ?? "";
  const channelId = channelSlug(body?.name ?? "");
  if (!safeId(orgId) || !channelId || !safeId(channelId)) {
    return NextResponse.json({ error: "Name the channel with letters or numbers." }, { status: 400 });
  }
  const member = await requireMember(user.uid, orgId);
  if (!member) return NextResponse.json({ error: "You are not in this organization." }, { status: 403 });
  const existing = await dbGet(`orgs/${orgId}/channels/${channelId}`);
  if (!existing) {
    await dbUpdate({
      [`orgs/${orgId}/channels/${channelId}`]: { name: channelId, createdAt: Date.now() },
    });
  }
  return NextResponse.json({ channelId });
}
