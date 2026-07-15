import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "browser-mcp — Hosted Chrome as an MCP skill",
  description:
    "Give any MCP-compatible agent a real Chrome browser: navigate, click, type, snapshot, and read pages. Human-like behaviour, encrypted credential storage for login-gated sites.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">
        {children}
      </body>
    </html>
  );
}
