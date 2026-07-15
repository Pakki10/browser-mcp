"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Cred {
  domain: string;
  username: string;
  savedAt: string | Date;
}

export function CredentialsPanel({ initial }: { initial: Cred[] }) {
  const [creds, setCreds] = useState(initial);
  const [domain, setDomain] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: domain.trim(),
          username,
          password,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? "Failed to save.");
        return;
      }
      setCreds((c) => [
        { domain: domain.trim(), username, savedAt: new Date().toISOString() },
        ...c.filter((x) => x.domain !== domain.trim()),
      ]);
      setDomain("");
      setUsername("");
      setPassword("");
      router.refresh();
    });
  };

  const remove = (d: string) => {
    startTransition(async () => {
      await fetch(`/api/credentials?domain=${encodeURIComponent(d)}`, {
        method: "DELETE",
      });
      setCreds((c) => c.filter((x) => x.domain !== d));
      router.refresh();
    });
  };

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <p className="mb-4 text-sm text-neutral-400">
        Save site logins here so your agent can access login-gated pages. Passwords are AES-256-GCM encrypted on our server and never returned over the API — <code className="rounded bg-black/40 px-1.5 py-0.5">use_credentials</code> types them into forms directly.
      </p>

      <form onSubmit={save} className="grid gap-2 sm:grid-cols-4 mb-4">
        <input
          type="text"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="workit.info"
          className="rounded bg-black/60 px-3 py-2 font-mono text-xs text-neutral-100 placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="username or email"
          className="rounded bg-black/60 px-3 py-2 text-xs text-neutral-100 placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="password"
          className="rounded bg-black/60 px-3 py-2 text-xs text-neutral-100 placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <button
          type="submit"
          disabled={pending || !domain.trim() || !username || !password}
          className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-black hover:bg-teal-400 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </form>
      {error && <p className="mb-3 text-xs text-red-400">{error}</p>}

      {creds.length > 0 ? (
        <ul className="divide-y divide-neutral-800">
          {creds.map((c) => (
            <li key={c.domain} className="flex items-center justify-between py-2">
              <div>
                <div className="font-mono text-sm text-neutral-100">{c.domain}</div>
                <div className="text-xs text-neutral-500">
                  {c.username} · saved {typeof c.savedAt === "string" ? c.savedAt.slice(0, 10) : c.savedAt.toISOString().slice(0, 10)}
                </div>
              </div>
              <button
                onClick={() => remove(c.domain)}
                className="text-xs text-red-400 hover:underline"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-neutral-500">No credentials saved yet.</p>
      )}
    </div>
  );
}
