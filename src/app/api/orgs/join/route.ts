import { NextResponse } from "next/server";
import { currentUser, unauthorized } from "@/lib/account";
import { dbGet, dbUpdate } from "@/lib/rtdb";

export const dynamic = "force-dynamic";

type Invite = { orgId: string; orgName: string };

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthorized();
  const body = (await request.json().catch(() => null)) as { code?: string } | null;
  const code = body?.code?.trim().toUpperCase() ?? "";
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    return NextResponse.json({ error: "Enter the 6-character invite code." }, { status: 400 });
  }
  const invite = await dbGet<Invite>(`invites/${code}`);
  if (!invite?.orgId) return NextResponse.json({ error: "That invite code does not match an organization." }, { status: 404 });
  const existing = await dbGet(`memberships/${user.uid}/${invite.orgId}`);
  if (!existing) {
    const now = Date.now();
    await dbUpdate({
      [`memberships/${user.uid}/${invite.orgId}`]: { orgName: invite.orgName, role: "member", joinedAt: now },
      [`orgs/${invite.orgId}/members/${user.uid}`]: { name: user.name, role: "member", joinedAt: now },
    });
  }
  return NextResponse.json({ orgId: invite.orgId, name: invite.orgName });
}
