// Playwright session manager.
//
// One shared Chromium instance, N BrowserContexts (one per session), one Page
// per context. Sessions live in an in-memory Map keyed by sessionId. A
// mirror row lives in the BrowserSession Prisma model for audit + cleanup.
//
// The sweeper (setInterval) closes contexts that haven't been touched in
// SESSION_IDLE_MS to free RAM.
//
// Stealth: we pass Chromium args and inject a small init script that strips
// the most obvious "I am a bot" signals (navigator.webdriver, plugins array,
// languages). This is NOT a full stealth stack (no residential proxies, no
// TLS fingerprint spoofing) — heavily-guarded sites like Cloudflare Turnstile
// will still detect. Good enough for most public sites.

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { randomUUID } from "node:crypto";
import { prisma } from "./db";
import { encrypt, decrypt } from "./crypto";

const SESSION_IDLE_MS = 15 * 60 * 1000; // 15 min
const SWEEP_INTERVAL_MS = 60 * 1000;    // 1 min

interface Session {
  userId: string;
  context: BrowserContext;
  page: Page;
  lastUsedAt: number;
}

const sessions = new Map<string, Session>();
let sharedBrowser: Browser | null = null;
let sweeperStarted = false;

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser && sharedBrowser.isConnected()) return sharedBrowser;
  sharedBrowser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });
  startSweeper();
  return sharedBrowser;
}

function startSweeper() {
  if (sweeperStarted) return;
  sweeperStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const [id, sess] of sessions) {
      if (now - sess.lastUsedAt > SESSION_IDLE_MS) {
        sess.context.close().catch(() => undefined);
        sessions.delete(id);
        prisma.browserSession
          .update({ where: { id }, data: { closedAt: new Date() } })
          .catch(() => undefined);
      }
    }
  }, SWEEP_INTERVAL_MS).unref();
}

// Small init script — Playwright injects into every page in the context.
// Strips the most obvious automation tells.
const STEALTH_INIT = `
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
window.chrome = { runtime: {} };
const originalQuery = window.navigator.permissions?.query;
if (originalQuery) {
  window.navigator.permissions.query = (parameters) =>
    parameters.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission })
      : originalQuery(parameters);
}
`;

export async function newSession(userId: string): Promise<string> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    locale: "en-US",
    timezoneId: "America/New_York",
    deviceScaleFactor: 1,
    hasTouch: false,
  });
  await context.addInitScript(STEALTH_INIT);
  const page = await context.newPage();
  const sessionId = randomUUID();
  const now = new Date();
  sessions.set(sessionId, { userId, context, page, lastUsedAt: now.getTime() });
  await prisma.browserSession.create({
    data: {
      id: sessionId,
      userId,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + SESSION_IDLE_MS),
    },
  });
  return sessionId;
}

function requireSession(sessionId: string, userId: string): Session {
  const s = sessions.get(sessionId);
  if (!s) throw new Error(`unknown or expired session: ${sessionId}. Call browser_new_session first.`);
  if (s.userId !== userId) throw new Error("session does not belong to this API key");
  s.lastUsedAt = Date.now();
  prisma.browserSession
    .update({
      where: { id: sessionId },
      data: {
        lastUsedAt: new Date(),
        expiresAt: new Date(Date.now() + SESSION_IDLE_MS),
      },
    })
    .catch(() => undefined);
  return s;
}

export async function closeSession(sessionId: string, userId: string): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s || s.userId !== userId) return;
  await s.context.close().catch(() => undefined);
  sessions.delete(sessionId);
  await prisma.browserSession
    .update({ where: { id: sessionId }, data: { closedAt: new Date() } })
    .catch(() => undefined);
}

export async function navigate(sessionId: string, userId: string, url: string): Promise<{ url: string; title: string }> {
  const s = requireSession(sessionId, userId);
  await s.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  return { url: s.page.url(), title: await s.page.title() };
}

// A11y-tree snapshot with per-node uids so the agent can target by uid,
// not by CSS selector. Same pattern as chrome-agent's browser_snapshot.
export async function snapshot(sessionId: string, userId: string): Promise<unknown> {
  const s = requireSession(sessionId, userId);
  const tree = await s.page.accessibility.snapshot({ interestingOnly: true });
  const elements: Array<{ uid: string; role: string; name: string; value?: string }> = [];
  const walk = (node: unknown, path: string) => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    const role = String(n.role ?? "");
    const name = String(n.name ?? "").slice(0, 120);
    const value = n.value ? String(n.value).slice(0, 120) : undefined;
    if (role && role !== "generic" && role !== "none" && (name || value || role === "textbox" || role === "button")) {
      elements.push({ uid: path, role, name, value });
    }
    const children = (n.children ?? []) as unknown[];
    children.forEach((c, i) => walk(c, path ? `${path}.${i}` : `${i}`));
  };
  walk(tree, "");
  return { url: s.page.url(), title: await s.page.title(), elements };
}

async function findByUid(page: Page, uid: string) {
  // Simple re-walk of the a11y tree to convert a uid path into a Locator.
  // Not fast, but robust — we don't cache anything so page mutations between
  // snapshot and click don't break.
  const tree = await page.accessibility.snapshot({ interestingOnly: true });
  const path = uid.split(".").map(Number);
  let node: unknown = tree;
  for (const idx of path) {
    if (!node || typeof node !== "object") return null;
    const n = node as { children?: unknown[] };
    if (!n.children || !n.children[idx]) return null;
    node = n.children[idx];
  }
  if (!node) return null;
  const n = node as { role?: string; name?: string };
  // Use Playwright's getByRole locator — matches role + accessible name.
  return page.getByRole(n.role as never, { name: n.name ?? undefined }).first();
}

export async function click(sessionId: string, userId: string, uid: string): Promise<{ ok: true }> {
  const s = requireSession(sessionId, userId);
  const loc = await findByUid(s.page, uid);
  if (!loc) throw new Error(`no element for uid ${uid}`);
  await loc.click({ timeout: 10000 });
  return { ok: true };
}

export async function type(sessionId: string, userId: string, uid: string, text: string): Promise<{ ok: true }> {
  const s = requireSession(sessionId, userId);
  const loc = await findByUid(s.page, uid);
  if (!loc) throw new Error(`no element for uid ${uid}`);
  await loc.fill(text, { timeout: 10000 });
  return { ok: true };
}

export async function pressKey(sessionId: string, userId: string, key: string): Promise<{ ok: true }> {
  const s = requireSession(sessionId, userId);
  await s.page.keyboard.press(key);
  return { ok: true };
}

export async function waitFor(sessionId: string, userId: string, selector: string, timeoutMs = 10000): Promise<{ ok: true }> {
  const s = requireSession(sessionId, userId);
  await s.page.waitForSelector(selector, { timeout: timeoutMs });
  return { ok: true };
}

export async function readPage(sessionId: string, userId: string): Promise<{ url: string; title: string; text: string }> {
  const s = requireSession(sessionId, userId);
  const text = await s.page.evaluate(() => document.body?.innerText ?? "");
  return { url: s.page.url(), title: await s.page.title(), text: text.slice(0, 20000) };
}

export async function screenshot(sessionId: string, userId: string): Promise<{ pngBase64: string }> {
  const s = requireSession(sessionId, userId);
  const buf = await s.page.screenshot({ type: "png", fullPage: false });
  return { pngBase64: buf.toString("base64") };
}

// --- credentials ---

export async function saveCredentials(
  userId: string,
  domain: string,
  username: string,
  password: string,
): Promise<{ ok: true }> {
  await prisma.storedCredential.upsert({
    where: { userId_domain: { userId, domain } },
    create: { userId, domain, username, passwordEncrypted: encrypt(password) },
    update: { username, passwordEncrypted: encrypt(password) },
  });
  return { ok: true };
}

export async function useCredentials(
  sessionId: string,
  userId: string,
  domain: string,
  usernameSelector: string,
  passwordSelector: string,
): Promise<{ ok: true; usedDomain: string }> {
  const s = requireSession(sessionId, userId);
  const cred = await prisma.storedCredential.findUnique({
    where: { userId_domain: { userId, domain } },
  });
  if (!cred) {
    throw new Error(
      `No credentials saved for ${domain}. Save them at https://browser.regiq.in/dashboard first, or call save_credentials.`,
    );
  }
  const password = decrypt(cred.passwordEncrypted);
  // Fill via the DOM directly (no LLM ever sees the password).
  await s.page.locator(usernameSelector).fill(cred.username, { timeout: 10000 });
  await s.page.locator(passwordSelector).fill(password, { timeout: 10000 });
  return { ok: true, usedDomain: domain };
}

export async function listCredentials(userId: string): Promise<Array<{ domain: string; username: string; savedAt: Date }>> {
  const rows = await prisma.storedCredential.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: { domain: true, username: true, updatedAt: true },
  });
  return rows.map((r) => ({ domain: r.domain, username: r.username, savedAt: r.updatedAt }));
}

export async function deleteCredentials(userId: string, domain: string): Promise<{ ok: true }> {
  await prisma.storedCredential.deleteMany({ where: { userId, domain } });
  return { ok: true };
}
