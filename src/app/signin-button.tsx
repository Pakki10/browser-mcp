"use client";

import { signIn } from "next-auth/react";

const PROVIDER_META: Record<string, { label: string; primary?: boolean }> = {
  google: { label: "Sign in with Google", primary: true },
  github: { label: "Sign in with GitHub" },
};

export function SignInButtons({ providers }: { providers: string[] }) {
  if (providers.length === 0) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
        No sign-in providers configured. Add credentials to <code className="rounded bg-black/40 px-1">.env</code>.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {providers.map((id) => {
        const meta = PROVIDER_META[id] ?? { label: `Sign in with ${id}` };
        const primary =
          meta.primary || (id === providers[0] && !providers.includes("google"));
        return (
          <button
            key={id}
            onClick={() => signIn(id, { callbackUrl: "/dashboard" })}
            className={
              primary
                ? "rounded-lg bg-teal-500 px-5 py-2.5 text-sm font-semibold text-black hover:bg-teal-400"
                : "rounded-lg border border-neutral-700 bg-neutral-900 px-5 py-2.5 text-sm text-neutral-200 hover:bg-neutral-800"
            }
          >
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}
