import { describe, expect, it } from "vitest";
import { isPublicAddress, safeRequest } from "../src/safe-network";

describe("scanner network boundary", () => {
  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "fe80::1", "fc00::1", "2002:7f00:1::", "2001:db8::1"])("rejects non-public address %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])("accepts public address %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });
  it.each(["http://127.0.0.1/", "http://[::1]/", "file:///etc/passwd", "https://user:secret@example.com/", "http://example.com:8080/"])("refuses unsafe URL before connecting: %s", async (url) => {
    await expect(safeRequest(url)).rejects.toThrow();
  });
})
