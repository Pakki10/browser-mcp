# We build on top of Microsoft's official Playwright image, which ships with
# Chromium + all system libraries pre-installed. Multi-stage keeps the final
# image lean-ish (still ~2 GB because of the browser).

FROM mcr.microsoft.com/playwright:v1.52.0-jammy AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
COPY prisma ./prisma/
RUN npm install --omit=optional

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Non-root user (Playwright base image already has one named `pwuser`)
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

EXPOSE 3000
CMD ["sh", "-c", "npx --yes prisma@6.19.2 migrate deploy 2>/dev/null; npx --yes prisma@6.19.2 db push --accept-data-loss --skip-generate && node server.js"]
