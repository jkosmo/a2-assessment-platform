type VersionFields = { versionMajor?: number | null; versionMinor?: number | null; versionNo?: number | null } | null | undefined;

export function moduleVersionNumber(version: VersionFields): string | null;
export function moduleVersionLabel(version: VersionFields): string;
