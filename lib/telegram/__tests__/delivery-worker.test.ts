import { describe, expect, it } from "vitest";
import { computeBackoffSeconds } from "../delivery-worker";

describe("computeBackoffSeconds", () => {
  it("grows exponentially with attempt count", () => {
    expect(computeBackoffSeconds(0)).toBe(5);
    expect(computeBackoffSeconds(1)).toBe(10);
    expect(computeBackoffSeconds(2)).toBe(20);
    expect(computeBackoffSeconds(3)).toBe(40);
  });

  it("caps at the maximum backoff", () => {
    expect(computeBackoffSeconds(10)).toBe(300);
    expect(computeBackoffSeconds(20)).toBe(300);
  });
});
