import { prisma } from "../../db/prisma.js";

export const platformConfigRepository = {
  async get(key: string): Promise<string | null> {
    const row = await prisma.platformConfig.findUnique({ where: { key } });
    return row?.value ?? null;
  },

  async getMany(keys: string[]): Promise<Record<string, string>> {
    const rows = await prisma.platformConfig.findMany({ where: { key: { in: keys } } });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  },

  async set(key: string, value: string, updatedBy?: string): Promise<void> {
    await prisma.platformConfig.upsert({
      where: { key },
      create: { key, value, updatedBy },
      update: { value, updatedBy },
    });
  },

  async setMany(entries: Record<string, string>, updatedBy?: string): Promise<void> {
    await prisma.$transaction(
      Object.entries(entries).map(([key, value]) =>
        prisma.platformConfig.upsert({
          where: { key },
          create: { key, value, updatedBy },
          update: { value, updatedBy },
        }),
      ),
    );
  },

  async list(): Promise<Array<{ key: string; value: string; updatedAt: Date; updatedBy: string | null }>> {
    return prisma.platformConfig.findMany({ orderBy: { key: "asc" } });
  },
};
