import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { handleToolError } from "../lib/toolUtils.js";

const SetInventoryQuantitiesInputSchema = z.object({
  reason: z.enum([
    "correction", "cycle_count_available", "damaged",
    "movement_created", "movement_updated", "movement_received", "movement_canceled",
    "other", "promotion", "quality_control", "received",
    "reservation_created", "reservation_deleted", "reservation_updated",
    "restock", "safety_stock", "shrinkage"
  ]).describe("Reason for the quantity change"),
  name: z.enum(["available", "on_hand"]).describe("Which quantity to set: 'available' or 'on_hand'"),
  quantities: z
    .array(
      z.object({
        inventoryItemId: z.string().describe("Inventory item GID"),
        locationId: z.string().describe("Location GID"),
        quantity: z.number().describe("Absolute quantity to set"),
        changeFromQuantity: z.number().int().nullable().optional().describe(
          "The quantity you expect is currently stored. Shopify only applies the change if it still matches, " +
          "and otherwise returns a CHANGE_FROM_QUANTITY_STALE error. Omit or pass null to set the quantity without this check."
        ),
      })
    )
    .min(1)
    .describe("Quantities to set for each inventory item at each location"),
  idempotencyKey: z.string().min(1).optional().describe(
    "Idempotency key for this request. Omit it and a new UUID is generated for each call. " +
    "Reuse a key only to retry the exact same request; a different request with the same key is rejected."
  ),
});

type SetInventoryQuantitiesInput = z.infer<typeof SetInventoryQuantitiesInputSchema>;

let shopifyClient: GraphQLClient;

const setInventoryQuantities = {
  name: "inventory-set-quantities",
  description:
    "Set absolute inventory quantities for items at specific locations. Use for inventory corrections, cycle counts, etc. " +
    "Pass changeFromQuantity per item to only apply the change if the current quantity still matches. " +
    "Returns the idempotencyKey used, so a failed call can be retried with the same key, plus userErrors.",
  schema: SetInventoryQuantitiesInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: SetInventoryQuantitiesInput) => {
    try {
      // Admin API 2026-04+ requires an idempotency key on this mutation
      const idempotencyKey = input.idempotencyKey ?? randomUUID();

      const query = gql`
        #graphql

        mutation inventorySetQuantities($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
          inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
            inventoryAdjustmentGroup {
              reason
              changes {
                name
                delta
                quantityAfterChange
                item {
                  id
                  sku
                }
                location {
                  id
                  name
                }
              }
            }
            userErrors {
              field
              message
              code
            }
          }
        }
      `;

      const data = (await shopifyClient.request(query, {
        input: {
          reason: input.reason,
          name: input.name,
          // changeFromQuantity replaced the old compare-and-set fields in 2026-04.
          // Shopify requires the key on every item, so send null explicitly when omitted
          // (?? keeps a caller-provided 0).
          quantities: input.quantities.map((q) => ({
            inventoryItemId: q.inventoryItemId,
            locationId: q.locationId,
            quantity: q.quantity,
            changeFromQuantity: q.changeFromQuantity ?? null,
          })),
        },
        idempotencyKey,
      })) as {
        inventorySetQuantities: {
          inventoryAdjustmentGroup: any;
          userErrors: Array<{ field: string[] | null; message: string; code: string | null }>;
        };
      };

      // userErrors are returned rather than thrown so their codes reach the caller
      return {
        idempotencyKey,
        adjustmentGroup: data.inventorySetQuantities.inventoryAdjustmentGroup,
        userErrors: data.inventorySetQuantities.userErrors,
      };
    } catch (error) {
      handleToolError("set inventory quantities", error);
    }
  },
};

export { setInventoryQuantities };
