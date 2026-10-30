import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";
import { checkUserErrors, handleToolError } from "../lib/toolUtils.js";
import type { ShopifyUserError } from "../lib/toolUtils.js";
import { normalizeDecimalAmount, normalizeGid } from "../lib/normalize.js";

// Input schema for updateInventoryItem
const UpdateInventoryItemInputSchema = z.object({
  inventoryItemId: z.string().min(1).describe(
    "The inventory item ID (e.g. gid://shopify/InventoryItem/123 or just 123). " +
    "This is not the variant ID; get it from get-inventory-items or get-product-variants-detailed.",
  ),
  cost: z.union([z.number().nonnegative(), z.string().min(1)]).optional().describe(
    "Unit cost in the shop's currency, as a number or decimal string (e.g. 12.5 or \"12.50\"). Must be >= 0.",
  ),
  tracked: z.boolean().optional().describe("Whether Shopify tracks inventory for this item"),
});

type UpdateInventoryItemInput = z.infer<typeof UpdateInventoryItemInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const updateInventoryItem = {
  name: "update-inventory-item",
  description:
    "Set an inventory item's unit cost and/or whether its inventory is tracked. Provide at least one of cost or tracked. " +
    "Read the cost back with get-inventory-items.",
  schema: UpdateInventoryItemInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: UpdateInventoryItemInput) => {
    try {
      if (input.cost === undefined && input.tracked === undefined) {
        throw new Error("Failed to update inventory item: provide at least one of cost or tracked");
      }

      const id = normalizeGid("InventoryItem", input.inventoryItemId);

      const itemInput: Record<string, unknown> = {};
      if (input.cost !== undefined) itemInput.cost = normalizeDecimalAmount(input.cost, "cost");
      if (input.tracked !== undefined) itemInput.tracked = input.tracked;

      // InventoryItem.variant is deprecated in 2026-10 in favour of the variants connection
      const mutation = gql`
        #graphql

        mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
          inventoryItemUpdate(id: $id, input: $input) {
            inventoryItem {
              id
              tracked
              unitCost {
                amount
                currencyCode
              }
              variants(first: 1) {
                nodes {
                  id
                  product {
                    id
                    title
                  }
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const data = (await shopifyClient.request(mutation, { id, input: itemInput })) as {
        inventoryItemUpdate: {
          inventoryItem: any;
          userErrors: ShopifyUserError[];
        };
      };

      // userErrors become a tool error so a failed cost update is never mistaken for success
      checkUserErrors(data.inventoryItemUpdate.userErrors, "update inventory item");

      const item = data.inventoryItemUpdate.inventoryItem;
      if (!item) {
        throw new Error(`Failed to update inventory item: ${id} was not returned`);
      }
      const variant = item.variants?.nodes?.[0];

      return {
        inventoryItemId: item.id,
        unitCost: item.unitCost
          ? { amount: item.unitCost.amount, currencyCode: item.unitCost.currencyCode }
          : null,
        tracked: item.tracked,
        variantId: variant?.id ?? null,
        productId: variant?.product?.id ?? null,
        productTitle: variant?.product?.title ?? null,
        userErrors: data.inventoryItemUpdate.userErrors,
      };
    } catch (error) {
      handleToolError("update inventory item", error);
    }
  },
};

export { updateInventoryItem };
