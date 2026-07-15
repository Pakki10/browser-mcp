import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./db";

const KEY_PREFIX = "br_live_";

export interface GeneratedKey {
  raw: string;
  hash: string;
  displayPrefix: string;
}

export function generateKey(): GeneratedKey {
  const raw = KEY_PREFIX + randomBytes(24).toString("hex");
  const hash = sha256(raw);
  const displayPrefix = raw.slice(0, 12);
  return { raw, hash, displayPrefix };
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export async function findLiveKey(rawKey: string) {
  if (!rawKey || !rawKey.startsWith(KEY_PREFIX)) return null;
  const hash = sha256(rawKey);
  const row = await prisma.apiKey.findUnique({
    where: { keyHash: hash },
    include: { user: true },
  });
  if (!row || row.revokedAt) return null;
  prisma.apiKey
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
  return row;
}

export async function rotateKeyForUser(userId: string): Promise<GeneratedKey> {
  const fresh = generateKey();
  await prisma.$transaction([
    prisma.apiKey.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.apiKey.create({
      data: {
        userId,
        keyHash: fresh.hash,
        keyPrefix: fresh.displayPrefix,
      },
    }),
  ]);
  return fresh;
}

export async function getCurrentKeyPrefix(userId: string): Promise<string | null> {
  const row = await prisma.apiKey.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { keyPrefix: true },
  });
  return row?.keyPrefix ?? null;
}
