import { NextResponse } from "next/server";
import { currentUser, membershipsFor, unauthorized } from "@/lib/account";
import { dbUpdate } from "@/lib/rtdb";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthorized();
  const memberships = await membershipsFor(user.uid);
  return NextResponse.json({ user, memberships });
}

export async function PATCH(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthorized();
  const body = (await request.json().catch(() => null)) as { observing?: boolean } | null;
  if (typeof body?.observing !== "boolean") {
    return NextResponse.json({ error: "Missing observing flag." }, { status: 400 });
  }
  await dbUpdate({ [`users/${user.uid}/observing`]: body.observing });
  return NextResponse.json({ user: { ...user, observing: body.observing } });
}
