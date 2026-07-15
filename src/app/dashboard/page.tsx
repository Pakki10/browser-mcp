import { redirect } from "next/navigation";
import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import { getCurrentKeyPrefix } from "@/lib/keys";
import { listCredentials } from "@/lib/browser";
import { KeyPanel } from "./key-panel";
import { CredentialsPanel } from "./credentials-panel";

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const sp = await searchParams;
  const rawKey = typeof sp.freshKey === "string" ? sp.freshKey : null;
  const [prefix, credentials] = await Promise.all([
    getCurrentKeyPrefix(session.user.id),
    listCredentials(session.user.id),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Your browser-mcp dashboard</h1>
          <p className="mt-1 text-sm text-neutral-400">Signed in as {session.user.email}</p>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            Sign out
          </button>
        </form>
      </header>

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          MCP API key
        </h2>
        <KeyPanel initialPrefix={prefix} freshKey={rawKey} />
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          Saved credentials
        </h2>
        <CredentialsPanel initial={credentials} />
      </section>

      <section className="mt-6 rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Claude Desktop config
        </div>
        <pre className="overflow-x-auto rounded bg-black/40 p-3 text-xs text-neutral-200">
{`{
  "mcpServers": {
    "browser": {
      "url": "https://browser.regiq.in/api/mcp",
      "headers": {
        "Authorization": "Bearer <PASTE_YOUR_KEY>"
      }
    }
  }
}`}
        </pre>
        <p className="mt-3 text-xs text-neutral-500">
          <Link href="/" className="underline">← Back to overview</Link>
        </p>
      </section>
    </main>
  );
}
