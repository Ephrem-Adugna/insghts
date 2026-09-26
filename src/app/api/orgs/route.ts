import { NextResponse } from "next/server";
import { currentUser, unauthorized } from "@/lib/account";
import { inviteCode } from "@/lib/ids";
import { dbGet, dbUpdate } from "@/lib/rtdb";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthorized();
  const body = (await request.json().catch(() => null)) as { name?: string } | null;
  const name = body?.name?.trim() ?? "";
  if (name.length < 2 || name.length > 80) {
    return NextResponse.json({ error: "Name the organization." }, { status: 400 });
  }
  const orgId = crypto.randomUUID();
  let code = inviteCode();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const taken = await dbGet(`invites/${code}`);
    if (!taken) break;
    code = inviteCode();
  }
  const now = Date.now();
  await dbUpdate({
    [`orgs/${orgId}/name`]: name,
    [`orgs/${orgId}/createdAt`]: now,
    [`orgs/${orgId}/ownerId`]: user.uid,
    [`orgs/${orgId}/inviteCode`]: code,
    [`orgs/${orgId}/members/${user.uid}`]: { name: user.name, role: "admin", joinedAt: now },
    [`orgs/${orgId}/channels/general`]: { name: "general", createdAt: now },
    [`memberships/${user.uid}/${orgId}`]: { orgName: name, role: "admin", joinedAt: now },
    [`invites/${code}`]: { orgId, orgName: name },
  });
  return NextResponse.json({ orgId, inviteCode: code, name });
}
