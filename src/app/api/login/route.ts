import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { emailKey } from "@/lib/ids";
import { dbGet } from "@/lib/rtdb";
import { signSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type StoredUser = { name: string; email: string; passwordHash: string };

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: string; password?: string } | null;
  const email = body?.email?.trim().toLowerCase() ?? "";
  const password = body?.password ?? "";
  const uid = email ? await dbGet<string>(`usersByEmail/${emailKey(email)}`) : null;
  const user = uid ? await dbGet<StoredUser>(`users/${uid}`) : null;
  if (!uid || !user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
    return NextResponse.json({ error: "Email or password is wrong." }, { status: 401 });
  }
  return NextResponse.json({
    token: signSession(uid),
    user: { uid, name: user.name, email: user.email },
  });
}
