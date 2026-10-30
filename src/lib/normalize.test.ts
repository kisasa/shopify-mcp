import { describe, expect, it } from "@jest/globals";
import { normalizeDecimalAmount, normalizeGid } from "./normalize.js";

describe("normalizeGid", () => {
  it("passes through a GID of the expected type", () => {
    expect(normalizeGid("InventoryItem", "gid://shopify/InventoryItem/123")).toBe(
      "gid://shopify/InventoryItem/123",
    );
  });

  it("converts a bare numeric ID to a GID", () => {
    expect(normalizeGid("InventoryItem", "123")).toBe("gid://shopify/InventoryItem/123");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeGid("InventoryItem", "  123 ")).toBe("gid://shopify/InventoryItem/123");
    expect(normalizeGid("InventoryItem", " gid://shopify/InventoryItem/123\n")).toBe(
      "gid://shopify/InventoryItem/123",
    );
  });

  it("rejects a GID of a different resource type", () => {
    expect(() => normalizeGid("InventoryItem", "gid://shopify/ProductVariant/123")).toThrow(
      "Expected InventoryItem ID, got ProductVariant ID",
    );
  });

  it.each(["", "abc", "12a", "-5", "1.5", "gid://shopify/InventoryItem/", "gid://shopify/InventoryItem/abc"])(
    "rejects malformed input %p",
    (input) => {
      expect(() => normalizeGid("InventoryItem", input)).toThrow("Invalid InventoryItem ID");
    },
  );
});

describe("normalizeDecimalAmount", () => {
  it.each([
    [12.5, "12.5"],
    [0, "0"],
    [7, "7"],
    ["12.50", "12.50"],
    [" 3.00 ", "3.00"],
    ["0", "0"],
  ])("normalizes %p to %p", (input, expected) => {
    expect(normalizeDecimalAmount(input, "cost")).toBe(expected);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1e-7])("rejects the number %p", (input) => {
    expect(() => normalizeDecimalAmount(input, "cost")).toThrow("cost must be");
  });

  it.each(["-1", "+1", "abc", "1,000.00", "1e3", "12.", ".5", ""])("rejects the string %p", (input) => {
    expect(() => normalizeDecimalAmount(input, "cost")).toThrow("cost must be a non-negative decimal");
  });
});
