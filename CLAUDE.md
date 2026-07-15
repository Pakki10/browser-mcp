# Deploying browser-mcp to Hetzner + regiq.in

## Server
- SSH: `root@89.167.56.16`
- Service dir: `/opt/browser-mcp/`
- Domain: `browser.regiq.in`
- Containers: `browser-mcp-web`, `browser-mcp-db`
- **NEVER touch** other people's folders under `/opt/`.

## Deploy

```bash
tar --exclude=node_modules --exclude=.next --exclude=.git -cf - . \
  | ssh root@89.167.56.16 "mkdir -p /opt/browser-mcp && tar -xf - -C /opt/browser-mcp/"
ssh root@89.167.56.16 "cd /opt/browser-mcp && docker compose up -d --build"
```

The Playwright base image is ~2 GB — first build takes 5-10 min.

## Subdomain wiring

`/opt/platform/cloudflared/config.yml`, before the catch-all:
```yaml
- hostname: browser.regiq.in
  service: http://172.17.0.1:3013
```

Then:
```bash
ssh root@89.167.56.16 "docker restart platform-cloudflared-1"
ssh root@89.167.56.16 "docker exec platform-cloudflared-1 cloudflared tunnel route dns 0caf1caf-59f6-4f36-9ea5-4aa9a9f41d0b browser.regiq.in"
```

## Env vars

- `NEXTAUTH_SECRET`, `NEXTAUTH_URL=https://browser.regiq.in`, `PUBLIC_BASE_URL=https://browser.regiq.in`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google Cloud OAuth
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — GitHub OAuth App
- `CRED_ENCRYPTION_KEY` — `openssl rand -hex 32` — REQUIRED. Rotating invalidates every saved credential.
- `ADMIN_EMAILS` — comma-separated, defaults to shreyas.pavuluri@gmail.com

## Rules

- **No LLM in this stack.** Users bring their own agent.
- **Sessions live in memory.** A container restart kills all active browser sessions — users have to `browser_new_session` again.
- **Credentials encrypted at rest.** Never returned raw over the API — only typed into forms server-side via `use_credentials`.
- Expose `/api/admin/health`.
