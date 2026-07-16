# Multi-stage build on Microsoft's Playwright image (ships Playwright + all
# system libs). We also install real Google Chrome (stable channel) so
# Playwright can launch it via `channel: "chrome"` — a real Chrome binary is
# meaningfully less fingerprintable than bundled Chromium (TLS handshake,
# proprietary features, `navigator.userAgentData.brands`, etc.).

FROM mcr.microsoft.com/playwright:v1.52.0-jammy AS base
WORKDIR /app

# --- Install Google Chrome stable ---------------------------------------
# apt-key is deprecated on jammy in favour of signed-by=; use the newer form.
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      wget gnupg ca-certificates \
    && wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor > /usr/share/keyrings/google-linux.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-linux.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json* ./
COPY prisma ./prisma/
# Keep optional deps — lightningcss (Tailwind 4 CSS engine) ships its
# platform-native binary as an optional dep and the build breaks without it.
RUN npm install

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/package.json ./
# Playwright deps must be present at runtime for `import 'playwright'` to work
COPY --from=builder /app/node_modules/playwright ./node_modules/playwright
COPY --from=builder /app/node_modules/playwright-core ./node_modules/playwright-core

# Directory for per-user Chrome storage-state snapshots (mounted volume in
# compose so state survives container rebuilds).
RUN mkdir -p /data/profiles && chown -R pwuser:pwuser /data
VOLUME ["/data"]

EXPOSE 3000
CMD ["sh", "-c", "npx --yes prisma@6.19.2 migrate deploy 2>/dev/null; npx --yes prisma@6.19.2 db push --accept-data-loss --skip-generate && node server.js"]
