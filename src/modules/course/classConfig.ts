import { platformConfigRepository } from "../platformConfig/platformConfigRepository.js";

// #645/CL-1: Administrator-controlled toggle for Entra-linked classes (kind=ENTRA). Default OFF —
// only manual classes exist until an Administrator enables this (after Graph permissions are in
// place, CL-5). Stored as a PlatformConfig key so it can be flipped without a deploy.
export const CLASS_ENTRA_LINKING_KEY = "classEntraLinkingEnabled";

export async function isClassEntraLinkingEnabled(): Promise<boolean> {
  return (await platformConfigRepository.get(CLASS_ENTRA_LINKING_KEY)) === "true";
}
