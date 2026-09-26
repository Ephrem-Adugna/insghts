import { NextResponse } from "next/server";
import { dbGet } from "./rtdb";
import { readSessionToken } from "./session";

export type PublicUser = {
  uid: string;
  name: string;
  email: string;
  observing: boolean;
};

export type Membership = {
  orgName: string;
  role: "admin" | "member";
  joinedAt: number;
};

type StoredUser = {
  name: string;
  email: string;
  passwordHash: string;
  createdAt: number;
  observing?: boolean;
};

export async function currentUser(request: Request): Promise<PublicUser | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const uid = token ? readSessionToken(token) : null;
  if (!uid) return null;
  const user = await dbGet<StoredUser>(`users/${uid}`);
  if (!user?.email || !user.name) return null;
  return {
    uid,
    name: user.name,
    email: user.email,
    observing: user.observing !== false,
  };
}

export function unauthorized() {
  return NextResponse.json({ error: "Sign in required." }, { status: 401 });
}

export async function membershipsFor(uid: string) {
  const rows = (await dbGet<Record<string, Membership>>(`memberships/${uid}`)) ?? {};
  return Object.entries(rows).map(([orgId, row]) => ({
    orgId,
    orgName: row.orgName,
    role: row.role,
    joinedAt: row.joinedAt,
  }));
}

export async function requireMember(uid: string, orgId: string) {
  const row = await dbGet<Membership>(`memberships/${uid}/${orgId}`);
  if (!row) return null;
  return row;
}
