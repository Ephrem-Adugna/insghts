import { NextResponse } from "next/server";
import { currentUser, requireMember, unauthorized } from "@/lib/account";
import { safeId } from "@/lib/ids";
import { dbGet, dbUpdate } from "@/lib/rtdb";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthorized();
  const body = (await request.json().catch(() => null)) as {
    orgId?: string;
    channelId?: string;
    body?: string;
  } | null;
  const orgId = body?.orgId ?? "";
  const channelId = body?.channelId ?? "";
  const text = body?.body?.trim() ?? "";
  if (!safeId(orgId) || !safeId(channelId)) {
    return NextResponse.json({ error: "Unknown channel." }, { status: 400 });
  }
  if (!text || text.length > 4000) {
    return NextResponse.json({ error: "Write a message." }, { status: 400 });
  }
  const member = await requireMember(user.uid, orgId);
  if (!member) return NextResponse.json({ error: "You are not in this organization." }, { status: 403 });
  const channel = await dbGet(`orgs/${orgId}/channels/${channelId}`);
  if (!channel) return NextResponse.json({ error: "That channel does not exist." }, { status: 404 });
  const messageId = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await dbUpdate({
    [`orgs/${orgId}/messages/${channelId}/${messageId}`]: {
      uid: user.uid,
      name: user.name,
      body: text,
      createdAt: Date.now(),
    },
  });
  return NextResponse.json({ messageId });
}
