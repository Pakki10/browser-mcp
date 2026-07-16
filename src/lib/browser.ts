// Playwright session manager — now driving real Google Chrome (not
// Chromium) via `channel: "chrome"`, with per-user persistent storage
// state so cookies, localStorage, and IndexedDB survive between sessions
// and container restarts.
//
// Shape (v0.2):
//   - One shared real-Chrome instance (`chromium.launch({channel:"chrome"})`).
//   - One BrowserContext per session, hydrated from a per-user storage
//     state snapshot stored in Postgres (`UserBrowserState.state`). When a
//     session closes (explicit close, or idle sweep), we serialise
//     `context.storageState()` back to the DB so the NEXT session for the
//     same user resumes with the same cookies.
//   - One Page per context.
//   - Sessions still live in an in-memory Map keyed by sessionId + a mirror
//     row in `BrowserSession` for audit.
//
// Stealth: real Chrome + a beefier init script than v0.1 (spoofs webdriver,
// plugin/mimeType arrays with realistic PluginArray shape, chrome.runtime,
// WebGL vendor, permissions.query bug fix, iframe.contentWindow.chrome).
// Handles most public sites and medium-strength anti-bot; heavily-guarded
// stacks (PerimeterX, Cloudflare Turnstile, DataDome) still detect via IP
// reputation — no browser-level trick fixes datacenter-IP detection.

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
    // Use the real Google Chrome binary installed in the Dockerfile, not
    // Playwright's bundled Chromium. Chrome carries Google's proprietary
    // codec bits, its own TLS handshake, and `navigator.userAgentData.brands`
    // that includes "Google Chrome" — all of which anti-bot stacks look at.
    channel: "chrome",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-features=IsolateOrigins,site-per-process,AutomationControlled",
      "--disable-infobars",
      "--window-size=1920,1080",
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
        // Persist storage state before closing so the user's cookies survive.
        persistStorageState(sess).catch(() => undefined);
        sess.context.close().catch(() => undefined);
        sessions.delete(id);
        prisma.browserSession
          .update({ where: { id }, data: { closedAt: new Date() } })
          .catch(() => undefined);
      }
    }
  }, SWEEP_INTERVAL_MS).unref();
}

// --- Anti-detection init script -----------------------------------------
// Handles common JS-side fingerprints. Doesn't defeat professional stacks
// (they also check TLS/JA3 and IP reputation which no init script can touch).
const STEALTH_INIT = `
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

// Realistic plugin & mimeType arrays with PluginArray-shaped prototype
const fakePlugin = (name, filename) => ({
  name, filename, description: '', length: 1,
  item: () => null, namedItem: () => null,
});
Object.defineProperty(navigator, 'plugins', {
  get: () => {
    const arr = [
      fakePlugin('PDF Viewer', 'internal-pdf-viewer'),
      fakePlugin('Chrome PDF Viewer', 'internal-pdf-viewer'),
      fakePlugin('Chromium PDF Viewer', 'internal-pdf-viewer'),
      fakePlugin('Microsoft Edge PDF Viewer', 'internal-pdf-viewer'),
      fakePlugin('WebKit built-in PDF', 'internal-pdf-viewer'),
    ];
    try { Object.setPrototypeOf(arr, window.PluginArray?.prototype ?? Array.prototype); } catch (e) {}
    return arr;
  },
});
Object.defineProperty(navigator, 'mimeTypes', {
  get: () => [{ type: 'application/pdf', suffixes: 'pdf' }],
});
Object.defineProperty(navigator, 'languages', { get: () => ['en-GB', 'en-US', 'en'] });
Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

// window.chrome — realistic surface (empty runtime{} is a giveaway)
window.chrome = {
  runtime: { onConnect: undefined, onMessage: undefined, connect: () => ({}), sendMessage: () => ({}) },
  app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' } },
  csi: () => ({}),
  loadTimes: () => ({}),
};

// permissions.query — classic "notifications === denied when hidden" bug fix
const originalQuery = window.navigator.permissions?.query;
if (originalQuery) {
  window.navigator.permissions.query = (parameters) =>
    parameters.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission })
      : originalQuery(parameters);
}

// WebGL vendor/renderer — spoof to look like an integrated Intel GPU
try {
  const getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function (parameter) {
    if (parameter === 37445) return 'Intel Inc.';
    if (parameter === 37446) return 'Intel Iris OpenGL Engine';
    return getParameter.call(this, parameter);
  };
} catch (e) {}
`;

/**
 * Save the session's current storage state back to Postgres so the next
 * session for the same user resumes with the same cookies + localStorage.
 * Called before every context close (explicit + sweeper).
 */
async function persistStorageState(sess: Session): Promise<void> {
  try {
    const state = await sess.context.storageState();
    await prisma.userBrowserState.upsert({
      where: { userId: sess.userId },
      create: { userId: sess.userId, state: state as unknown as object },
      update: { state: state as unknown as object },
    });
  } catch (err) {
    console.warn(`[browser] persistStorageState failed for user ${sess.userId}:`, err);
  }
}

export async function newSession(userId: string): Promise<string> {
  const browser = await getBrowser();

  // Restore prior storage state if any — this is what makes logins stick
  // across sessions and container restarts.
  const savedState = await prisma.userBrowserState
    .findUnique({ where: { userId } })
    .catch(() => null);

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "en-GB",
    timezoneId: "Europe/London",
    deviceScaleFactor: 1,
    hasTouch: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(savedState ? { storageState: savedState.state as any } : {}),
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
  await persistStorageState(s);
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
