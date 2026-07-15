import Link from "next/link";
import { auth, enabledProviders } from "@/lib/auth";
import { SignInButtons } from "./signin-button";

const CONFIG_SNIPPET = `{
  "mcpServers": {
    "browser": {
      "url": "https://browser.regiq.in/api/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_KEY>"
      }
    }
  }
}`;

export default async function LandingPage() {
  const session = await auth().catch(() => null);
  const signedIn = !!session?.user;

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="mb-14">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1 text-xs text-neutral-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-400" />
          Hosted Chrome · MCP · streamable-http
        </div>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          browser-mcp
        </h1>
        <p className="mt-4 max-w-xl text-lg text-neutral-400">
          Give any MCP-compatible agent a real Chrome browser. Navigate, click, type, snapshot, read pages. Human-like behaviour, per-user isolation, encrypted credential storage so login-gated sites work without leaking passwords to the LLM.
        </p>
        <div className="mt-8">
          {signedIn ? (
            <div className="flex gap-3">
              <Link
                href="/dashboard"
                className="rounded-lg bg-teal-500 px-5 py-2.5 text-sm font-semibold text-black hover:bg-teal-400"
              >
                Open dashboard →
              </Link>
              <Link
                href="https://github.com/globalion/browser-mcp"
                target="_blank"
                className="rounded-lg border border-neutral-700 bg-neutral-900 px-5 py-2.5 text-sm text-neutral-200 hover:bg-neutral-800"
              >
                GitHub ↗
              </Link>
            </div>
          ) : (
            <div className="max-w-sm">
              <SignInButtons providers={enabledProviders} />
              <Link
                href="https://github.com/globalion/browser-mcp"
                target="_blank"
                className="mt-2 block text-center text-xs text-neutral-500 underline hover:text-neutral-300"
              >
                View on GitHub ↗
              </Link>
            </div>
          )}
        </div>
      </div>

      <section className="mb-12">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          How it fits
        </h2>
        <pre className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-xs leading-relaxed text-neutral-300">
{`Your agent  →  browser-mcp  →  Chromium on our server
   (Claude,       (JSON-RPC MCP)    (Playwright, per-user
    Cursor,                          isolated context)
    scripts)`}
        </pre>
      </section>

      <section className="mb-12">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          Setup
        </h2>
        <ol className="space-y-2 text-neutral-300">
          <li>1. Sign in with Google or GitHub.</li>
          <li>2. Generate an MCP API key on your dashboard.</li>
          <li>3. Add this to Claude Desktop / Cursor / your agent:</li>
        </ol>
        <pre className="mt-4 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-xs leading-relaxed text-neutral-200">
          {CONFIG_SNIPPET}
        </pre>
      </section>

      <section className="mb-12">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          Tools
        </h2>
        <ul className="space-y-1 text-sm text-neutral-400">
          <li>• <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-teal-300">browser_new_session()</code> → sessionId (15-min idle timeout)</li>
          <li>• <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-teal-300">browser_navigate(url)</code>, <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-teal-300">browser_snapshot()</code>, <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-teal-300">browser_read_page()</code>, <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-teal-300">browser_screenshot()</code></li>
          <li>• <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-teal-300">browser_click(uid)</code>, <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-teal-300">browser_type(uid, text)</code>, <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-teal-300">browser_press_key(key)</code>, <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-teal-300">browser_wait_for(selector)</code></li>
          <li>• <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-teal-300">save_credentials</code> / <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-teal-300">use_credentials</code> / <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-teal-300">list_saved_credentials</code> — passwords AES-256-GCM encrypted, never returned to the agent</li>
          <li>• <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-teal-300">browser_close_session(sessionId)</code></li>
        </ul>
      </section>

      <section className="mb-12">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          Free during beta
        </h2>
        <p className="text-neutral-300">
          One concurrent session per user, 15 min idle timeout. Bot-guarded sites (Cloudflare Turnstile, PerimeterX) may still detect — proxies and CAPTCHA-solve arrive in v0.2.
        </p>
      </section>

      <footer className="mt-16 border-t border-neutral-800 pt-6 text-xs text-neutral-500">
        Built by{" "}
        <Link href="https://github.com/Shreyas-Profile" target="_blank" className="underline">
          Shreyas
        </Link>{" "}
        · Shipped by{" "}
        <Link href="https://github.com/globalion" target="_blank" className="underline">
          Globalion
        </Link>{" "}
        · MIT
      </footer>
    </main>
  );
}
