import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { rotateKeyForUser } from "@/lib/keys";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const fresh = await rotateKeyForUser(session.user.id);
  return NextResponse.json({ key: fresh.raw, prefix: fresh.displayPrefix });
}
