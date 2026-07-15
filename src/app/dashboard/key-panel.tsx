"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function KeyPanel({
  initialPrefix,
  freshKey,
}: {
  initialPrefix: string | null;
  freshKey: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const rotate = () => {
    startTransition(async () => {
      const res = await fetch("/api/keys/rotate", { method: "POST" });
      if (res.ok) {
        const { key } = await res.json();
        router.replace(`/dashboard?freshKey=${encodeURIComponent(key)}`);
      }
    });
  };

  const copy = async () => {
    if (!freshKey) return;
    await navigator.clipboard.writeText(freshKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      {freshKey ? (
        <>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
            Save this now — you won&apos;t see it again
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-black/60 px-3 py-2 font-mono text-sm text-teal-300">
              {freshKey}
            </code>
            <button
              onClick={copy}
              className="rounded-lg bg-teal-500 px-3 py-2 text-xs font-semibold text-black hover:bg-teal-400"
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </>
      ) : initialPrefix ? (
        <>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Active key
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-black/40 px-3 py-2 font-mono text-sm text-neutral-300">
              {initialPrefix}
              <span className="text-neutral-600">…hidden</span>
            </code>
            <button
              onClick={rotate}
              disabled={pending}
              className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-60"
            >
              {pending ? "Rotating…" : "Regenerate"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="mb-3 text-neutral-300">
            Generate a key to plug browser-mcp into Claude Desktop, Cursor, or any MCP client.
          </div>
          <button
            onClick={rotate}
            disabled={pending}
            className="rounded-lg bg-teal-500 px-5 py-2 text-sm font-semibold text-black hover:bg-teal-400 disabled:opacity-60"
          >
            {pending ? "Generating…" : "Generate my key"}
          </button>
        </>
      )}
    </div>
  );
}
