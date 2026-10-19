import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";
import { handleToolError } from "../lib/toolUtils.js";
import type { ShopifyUserError } from "../lib/toolUtils.js";

// Input schema for manageProductVariants
const VariantOptionSchema = z.object({
  optionName: z.string().describe("Option name, e.g. 'Size' or 'Color'"),
  name: z.string().describe("Option value, e.g. '8x10' or 'Black'"),
});

const VariantSchema = z.object({
  id: z.string().optional().describe("Variant GID for updates. Omit to create new."),
  price: z.string().optional().describe("Price as string, e.g. '49.00'"),
  compareAtPrice: z.string().optional().describe("Compare-at price for showing discounts, e.g. '79.00'"),
  sku: z.string().optional().describe("SKU for the variant (mapped to inventoryItem.sku)"),
  tracked: z.boolean().optional().describe("Whether inventory is tracked. Set false for print-on-demand."),
  taxable: z.boolean().optional().describe("Whether the variant is taxable"),
  barcode: z.string().optional(),
  weight: z.number().optional().describe("Weight of the variant"),
  weightUnit: z.enum(["GRAMS", "KILOGRAMS", "OUNCES", "POUNDS"]).optional().describe("Unit of weight"),
  optionValues: z.array(VariantOptionSchema).optional(),
  mediaId: z.string().optional().describe("Product media GID (gid://shopify/MediaImage/...) to set as this variant's image. Must already be attached to the product (see add-product-media / get-product-media)."),
  inventoryPolicy: z.enum(["DENY", "CONTINUE"]).optional().describe("Whether the variant can be sold when inventory is 0: DENY stops sales, CONTINUE allows overselling"),
});

const ManageProductVariantsInputSchema = z.object({
  productId: z.string().min(1).describe("Shopify product GID"),
  variants: z.array(VariantSchema).min(1).describe("Variants to create or update"),
  strategy: z
    .enum(["DEFAULT", "REMOVE_STANDALONE_VARIANT", "PRESERVE_STANDALONE_VARIANT"])
    .optional()
    .describe(
      "Strategy for handling the standalone 'Default Title' variant when creating. DEFAULT removes it automatically."
    ),
});

type ManageProductVariantsInput = z.infer<typeof ManageProductVariantsInputSchema>;

// Format a variant from the bulk create/update payloads
const formatVariant = (v: any) => ({
  id: v.id,
  title: v.title,
  price: v.price,
  sku: v.sku,
  options: v.selectedOptions,
  inventoryPolicy: v.inventoryPolicy,
  mediaId: v.media?.edges?.[0]?.node?.id ?? null,
  imageUrl: v.media?.edges?.[0]?.node?.image?.url ?? null,
});

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const manageProductVariants = {
  name: "manage-product-variants",
  description:
    "Create or update product variants. Omit variant id to create new, include id to update existing.",
  schema: ManageProductVariantsInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: ManageProductVariantsInput) => {
    try {
      const { productId, variants } = input;

      // Split into creates and updates
      const toCreate = variants.filter((v) => !v.id);
      const toUpdate = variants.filter((v) => v.id);

      // userErrors are returned rather than thrown, tagged with the operation that produced them
      const results: {
        created: any[];
        updated: any[];
        userErrors: Array<ShopifyUserError & { operation: "create" | "update" }>;
      } = {
        created: [],
        updated: [],
        userErrors: [],
      };

      // Bulk create new variants
      if (toCreate.length > 0) {
        const createQuery = gql`
          #graphql

          mutation productVariantsBulkCreate(
            $productId: ID!
            $variants: [ProductVariantsBulkInput!]!
            $strategy: ProductVariantsBulkCreateStrategy
          ) {
            productVariantsBulkCreate(
              productId: $productId
              variants: $variants
              strategy: $strategy
            ) {
              productVariants {
                id
                title
                price
                sku
                selectedOptions {
                  name
                  value
                }
                inventoryPolicy
                media(first: 1) {
                  edges {
                    node {
                      id
                      ... on MediaImage {
                        image {
                          url
                        }
                      }
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

        const createVariants = toCreate.map((v) => {
          const variant: Record<string, any> = {};
          if (v.price) variant.price = v.price;
          if (v.compareAtPrice) variant.compareAtPrice = v.compareAtPrice;
          if (v.barcode) variant.barcode = v.barcode;
          if (v.taxable !== undefined) variant.taxable = v.taxable;
          // sku and tracked both go under inventoryItem
          const inventoryItem: Record<string, any> = {};
          if (v.sku) inventoryItem.sku = v.sku;
          if (v.tracked !== undefined) inventoryItem.tracked = v.tracked;
          if (v.weight !== undefined) {
            inventoryItem.measurement = { weight: { value: v.weight, unit: v.weightUnit || 'GRAMS' } };
          }
          if (Object.keys(inventoryItem).length > 0) variant.inventoryItem = inventoryItem;
          if (v.optionValues) {
            variant.optionValues = v.optionValues.map((ov) => ({
              optionName: ov.optionName,
              name: ov.name,
            }));
          }
          if (v.mediaId) variant.mediaId = v.mediaId;
          if (v.inventoryPolicy) variant.inventoryPolicy = v.inventoryPolicy;
          return variant;
        });

        const createData = (await shopifyClient.request(createQuery, {
          productId,
          variants: createVariants,
          ...(input.strategy && { strategy: input.strategy }),
        })) as {
          productVariantsBulkCreate: {
            productVariants: any[];
            userErrors: ShopifyUserError[];
          };
        };

        const { productVariants, userErrors } = createData.productVariantsBulkCreate;
        results.userErrors.push(...userErrors.map((e) => ({ operation: "create" as const, ...e })));
        results.created = (productVariants ?? []).map(formatVariant);
      }

      // Bulk update existing variants
      if (toUpdate.length > 0) {
        const updateQuery = gql`
          #graphql

          mutation productVariantsBulkUpdate(
            $productId: ID!
            $variants: [ProductVariantsBulkInput!]!
          ) {
            productVariantsBulkUpdate(
              productId: $productId
              variants: $variants
            ) {
              productVariants {
                id
                title
                price
                sku
                selectedOptions {
                  name
                  value
                }
                inventoryPolicy
                media(first: 1) {
                  edges {
                    node {
                      id
                      ... on MediaImage {
                        image {
                          url
                        }
                      }
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

        const updateVariants = toUpdate.map((v) => {
          const variant: Record<string, any> = { id: v.id };
          if (v.price) variant.price = v.price;
          if (v.compareAtPrice) variant.compareAtPrice = v.compareAtPrice;
          if (v.barcode) variant.barcode = v.barcode;
          if (v.taxable !== undefined) variant.taxable = v.taxable;
          const inventoryItem: Record<string, any> = {};
          if (v.sku) inventoryItem.sku = v.sku;
          if (v.tracked !== undefined) inventoryItem.tracked = v.tracked;
          if (v.weight !== undefined) {
            inventoryItem.measurement = { weight: { value: v.weight, unit: v.weightUnit || 'GRAMS' } };
          }
          if (Object.keys(inventoryItem).length > 0) variant.inventoryItem = inventoryItem;
          if (v.optionValues) {
            variant.optionValues = v.optionValues.map((ov) => ({
              optionName: ov.optionName,
              name: ov.name,
            }));
          }
          if (v.mediaId) variant.mediaId = v.mediaId;
          if (v.inventoryPolicy) variant.inventoryPolicy = v.inventoryPolicy;
          return variant;
        });

        const updateData = (await shopifyClient.request(updateQuery, {
          productId,
          variants: updateVariants,
        })) as {
          productVariantsBulkUpdate: {
            productVariants: any[];
            userErrors: ShopifyUserError[];
          };
        };

        const { productVariants, userErrors } = updateData.productVariantsBulkUpdate;
        results.userErrors.push(...userErrors.map((e) => ({ operation: "update" as const, ...e })));
        results.updated = (productVariants ?? []).map(formatVariant);
      }

      return results;
    } catch (error) {
      handleToolError("manage product variants", error);
    }
  },
};

export { manageProductVariants };
