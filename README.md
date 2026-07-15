# browser-mcp

> Built by [**Shreyas**](https://github.com/Shreyas-Profile) · Shipped by [**Globalion**](https://github.com/globalion)

**Hosted Chrome as an MCP skill.** Give any MCP-compatible agent (Claude Desktop, Cursor, custom scripts) a real Chromium browser to drive — navigate, click, type, snapshot, read pages, take screenshots. Human-like behaviour, per-user isolated sessions, encrypted credential storage so login-gated sites work without leaking passwords to the LLM.

- **Real Chromium** on our server via Playwright. Not headless-only tricks — full browser context.
- **Stealth defaults** — patches the most common bot-detection tells (navigator.webdriver, plugins, chrome runtime). Not bulletproof against heavy defences like Cloudflare Turnstile; v0.2 adds proxies + CAPTCHA solving.
- **Per-user isolation** — separate BrowserContext per user, so cookies + localStorage don't leak between accounts.
- **Encrypted credentials** — AES-256-GCM at rest. `use_credentials` types the password into the page server-side; the LLM never sees it.
- **No LLM in our stack** — your agent is the brain. We just drive the browser.

Hosted at **[browser.regiq.in](https://browser.regiq.in)**.

## Use it

1. Visit https://browser.regiq.in and sign in with Google or GitHub.
2. Generate an MCP API key on the dashboard.
3. Add to Claude Desktop's `claude_desktop_config.json`:

    ```json
    {
      "mcpServers": {
        "browser": {
          "url": "https://browser.regiq.in/api/mcp",
          "headers": {
            "Authorization": "Bearer YOUR_KEY_HERE"
          }
        }
      }
    }
    ```

4. Restart Claude Desktop. Ask it: *"open workit.info and search for placements in Cambridge."* Your agent will call the browser tools and drive the page.

## Tools

| Tool | Purpose |
|------|---------|
| `browser_new_session()` | Spin up a session; returns `sessionId`. 15 min idle timeout. |
| `browser_close_session(sessionId)` | Clean up. |
| `browser_navigate(sessionId, url)` | Go to URL, wait for DOMContentLoaded. |
| `browser_snapshot(sessionId)` | Accessibility tree with per-element uids. |
| `browser_click(sessionId, uid)` | Click element by uid. |
| `browser_type(sessionId, uid, text)` | Fill input by uid. |
| `browser_press_key(sessionId, key)` | Keyboard press: `Enter`, `Tab`, `Control+A`, etc. |
| `browser_wait_for(sessionId, selector)` | Wait for CSS selector to appear. |
| `browser_read_page(sessionId)` | Plain-text page content (20 KB cap). |
| `browser_screenshot(sessionId)` | PNG as base64. |
| `save_credentials(domain, username, password)` | Encrypt + store login for a site. |
| `use_credentials(sessionId, domain, usernameSelector, passwordSelector)` | Type stored creds into a login form. Password never returned. |
| `list_saved_credentials()` | See what's stored (domains + usernames only). |

## Handling login-gated sites

Your agent sees a login form. Flow:

1. **Check for saved creds** — `list_saved_credentials()`.
2. **If saved for this domain** — call `use_credentials(sessionId, "workit.info", "input[name=email]", "input[type=password]")`. Server decrypts + types. Then click the submit button.
3. **If not saved** — tell the user: *"I need your workit.info login to continue. Save it at https://browser.regiq.in/dashboard, then ask me again."*

For MVP the user has to save creds via the dashboard. v0.2 will let the agent request creds through a paired channel (e.g. via [telegram-mcp](https://github.com/globalion/telegram-mcp)).

## Self-host

You'll need:
- Docker + Compose
- A Google or GitHub OAuth client
- A public HTTPS domain (Cloudflare Tunnel or `ngrok http 3013`)
- ~4 GB RAM (Playwright + Chromium)

```bash
git clone https://github.com/globalion/browser-mcp
cd browser-mcp
cp .env.example .env
# fill NEXTAUTH_SECRET, GOOGLE_/GITHUB_*, PUBLIC_BASE_URL,
# and generate CRED_ENCRYPTION_KEY with `openssl rand -hex 32`
docker compose up -d
# open http://localhost:3013
```

## Architecture

```
Your MCP agent  →  /api/mcp (Bearer auth)  →  In-memory session Map  →  Playwright BrowserContext
                                                    ↕
                                                Postgres (audit + credentials, AES-256-GCM)
```

Sessions live in the container's memory. A restart kills all active sessions — users just call `browser_new_session` again. Contexts auto-close after 15 min idle to free RAM.

## Bot avoidance — realistic expectations

The stealth init script strips `navigator.webdriver`, adds fake plugins, exposes `window.chrome.runtime`, and patches the notifications permission oddity. Combined with a real Chromium binary (not headless-only) and realistic viewport/UA/timezone, that gets past most public sites.

Sites with **serious** anti-bot (Cloudflare Turnstile, PerimeterX, DataDome) will still detect. To bypass those you need:
- Residential proxies (~$50/mo services like Bright Data)
- CAPTCHA solving (~$0.001/solve via 2captcha)
- More elaborate fingerprint spoofing

That's v0.2 territory. For now, use `browser-mcp` on sites that aren't actively hunting bots.

## License

MIT.
