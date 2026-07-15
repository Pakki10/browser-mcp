// Session-authed CRUD for stored credentials. Used by the dashboard credential
// panel. The MCP tools (save_credentials, use_credentials, list_saved_credentials)
// cover the agent-driven path; this route is for the user's own UI.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  saveCredentials,
  listCredentials,
  deleteCredentials,
} from "@/lib/browser";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const credentials = await listCredentials(session.user.id);
  return NextResponse.json({ credentials });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as {
    domain?: string;
    username?: string;
    password?: string;
  } | null;
  if (!body?.domain || !body.username || !body.password) {
    return NextResponse.json(
      { error: "domain, username, and password are required" },
      { status: 400 },
    );
  }
  await saveCredentials(session.user.id, body.domain.trim(), body.username, body.password);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const domain = url.searchParams.get("domain");
  if (!domain) {
    return NextResponse.json({ error: "domain query param required" }, { status: 400 });
  }
  await deleteCredentials(session.user.id, domain);
  return NextResponse.json({ ok: true });
}
