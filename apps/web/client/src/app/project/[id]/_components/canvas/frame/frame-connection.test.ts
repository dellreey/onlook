import { describe, expect, it } from "bun:test";
import { shouldConnectFrameToPenpal } from "./frame-connection";

describe("shouldConnectFrameToPenpal", () => {
  it("skips the Onlook preload protocol for a Driven preview frame", () => {
    expect(shouldConnectFrameToPenpal("home")).toBe(false);
  });

  it("keeps the Onlook preload protocol for ordinary project frames", () => {
    expect(shouldConnectFrameToPenpal(null)).toBe(true);
    expect(shouldConnectFrameToPenpal(undefined)).toBe(true);
  });
});
