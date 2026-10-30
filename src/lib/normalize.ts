// ── Input normalization ───────────────────────────────────────────────
//
// Pure helpers for turning loosely formatted tool inputs into the exact
// values the Admin API expects. Kept free of client/network code so they
// can be unit tested directly.

/**
 * Normalize a Shopify ID to a GID of the given resource type.
 * Accepts a full GID ("gid://shopify/InventoryItem/123") or a bare numeric ID ("123").
 * Rejects GIDs of a different resource type, which is a common mix-up
 * (e.g. passing a ProductVariant GID where an InventoryItem GID is needed).
 */
export function normalizeGid(resourceType: string, id: string): string {
  const trimmed = id.trim();

  if (/^\d+$/.test(trimmed)) {
    return `gid://shopify/${resourceType}/${trimmed}`;
  }

  const match = /^gid:\/\/shopify\/([A-Za-z]+)\/(\d+)$/.exec(trimmed);
  if (match) {
    if (match[1] !== resourceType) {
      throw new Error(`Expected ${resourceType} ID, got ${match[1]} ID: ${trimmed}`);
    }
    return trimmed;
  }

  throw new Error(
    `Invalid ${resourceType} ID "${id}". Use gid://shopify/${resourceType}/<number> or the bare number.`,
  );
}

/**
 * Normalize a non-negative money amount to the decimal string the Admin API's
 * Decimal scalar expects (e.g. 12.5 -> "12.5", " 3.00 " -> "3.00").
 */
export function normalizeDecimalAmount(value: number | string, fieldName = "amount"): string {
  let text: string;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${fieldName} must be a finite number, got ${value}`);
    }
    text = String(value);
  } else {
    text = value.trim();
  }

  // Plain decimal only: rejects negatives, signs, exponents ("1e-7"), and commas
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new Error(`${fieldName} must be a non-negative decimal number like 12.50, got "${value}"`);
  }

  return text;
}
