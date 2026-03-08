import path from "node:path";

export function resolveSqliteFilePath(databaseUrl) {
  if (!databaseUrl || !databaseUrl.startsWith("file:")) {
    throw new Error(`Unsupported DATABASE_URL for runtime migration: ${databaseUrl}`);
  }

  const filePart = databaseUrl.slice("file:".length);
  if (!filePart) {
    throw new Error("DATABASE_URL file path is empty.");
  }

  if (path.isAbsolute(filePart)) {
    return filePart;
  }

  const prismaSchemaDir = path.resolve(process.cwd(), "prisma");
  return path.resolve(prismaSchemaDir, filePart);
}

