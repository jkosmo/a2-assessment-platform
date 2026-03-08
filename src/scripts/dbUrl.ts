import path from "node:path";

export function resolveSqliteFilePath(databaseUrl: string): string {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error(`Unsupported DATABASE_URL for bootstrap migration runner: ${databaseUrl}`);
  }

  const filePart = databaseUrl.slice("file:".length);
  if (!filePart) {
    throw new Error("DATABASE_URL file path is empty.");
  }

  if (path.isAbsolute(filePart)) {
    return filePart;
  }

  // Prisma resolves relative SQLite file URLs from the schema directory.
  const prismaSchemaDir = path.resolve(process.cwd(), "prisma");
  return path.resolve(prismaSchemaDir, filePart);
}
