/**
 * Driven previews are intentionally rendered without Onlook's preload script.
 * Connecting Penpal for them would time out and trigger the normal sandbox
 * retry loop, continuously reloading an otherwise healthy preview.
 */
export function shouldConnectFrameToPenpal(
  drivenPageId: string | null | undefined,
): boolean {
  return !drivenPageId;
}
