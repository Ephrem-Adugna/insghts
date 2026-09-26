import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { signSession } from "@/lib/session";
import { dbGet, dbUpdate } from "@/lib/rtdb";
import { emailKey } from "@/lib/ids";

export const dynamic = "force-dynamic";

type Body = { name?: string; email?: string; password?: string };

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Body | null;
  const name = body?.name?.trim() ?? "";
  const email = body?.email?.trim().toLowerCase() ?? "";
  const password = body?.password ?? "";
  if (name.length < 2 || name.length > 80) {
    return NextResponse.json({ error: "Enter your name." }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Use at least 8 characters." }, { status: 400 });
  }
  const key = emailKey(email);
  const existing = await dbGet<string>(`usersByEmail/${key}`);
  if (existing) return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
  const uid = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, 10);
  await dbUpdate({
    [`users/${uid}`]: {
      name,
      email,
      passwordHash,
      createdAt: Date.now(),
      observing: true,
    },
    [`usersByEmail/${key}`]: uid,
  });
  return NextResponse.json({ token: signSession(uid), user: { uid, name, email } });
}
