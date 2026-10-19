import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";
import { handleToolError, edgesToNodes } from "../lib/toolUtils.js";
import type { ShopifyUserError } from "../lib/toolUtils.js";

// Input schema for addProductMedia
const AddProductMediaInputSchema = z.object({
  productId: z.string().min(1).describe("Shopify product GID (e.g. gid://shopify/Product/123)"),
  media: z.array(z.object({
    originalSource: z.string().url().describe("Publicly accessible image URL for Shopify to download"),
    alt: z.string().optional().describe("Alt text for the image"),
  })).min(1).describe("Images to attach to the product"),
});

type AddProductMediaInput = z.infer<typeof AddProductMediaInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const addProductMedia = {
  name: "add-product-media",
  description: "Attach images to an existing product by public URL. Shopify processes media asynchronously: new items usually start as UPLOADED or PROCESSING. Use get-product-media to confirm they reach READY.",
  schema: AddProductMediaInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: AddProductMediaInput) => {
    try {
      const { productId, media } = input;

      // productUpdate returns the product, not the created media, so snapshot
      // existing media IDs first and diff afterwards to identify the new items.
      const existingQuery = gql`
        #graphql

        query productMediaIds($id: ID!) {
          product(id: $id) {
            id
            media(first: 250) {
              edges {
                node {
                  id
                }
              }
            }
          }
        }
      `;

      const existing = (await shopifyClient.request(existingQuery, { id: productId })) as {
        product: { id: string; media: any } | null;
      };

      if (!existing.product) {
        throw new Error(`Failed to add product media: Product ${productId} not found`);
      }

      const existingIds = new Set(
        edgesToNodes<{ id: string }>(existing.product.media).map((m) => m.id),
      );

      // productCreateMedia is deprecated as of 2026-01 in favour of productUpdate's media argument
      const mutation = gql`
        #graphql

        mutation productUpdateMedia($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
          productUpdate(product: $product, media: $media) {
            product {
              id
              media(first: 250) {
                edges {
                  node {
                    id
                    alt
                    status
                    mediaErrors {
                      code
                      details
                      message
                    }
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

      const data = (await shopifyClient.request(mutation, {
        product: { id: productId },
        media: media.map((m) => ({
          originalSource: m.originalSource,
          alt: m.alt,
          mediaContentType: "IMAGE",
        })),
      })) as {
        productUpdate: {
          product: { id: string; media: any } | null;
          userErrors: ShopifyUserError[];
        };
      };

      const { product, userErrors } = data.productUpdate;
      const created = product
        ? edgesToNodes<any>(product.media)
            .filter((m) => !existingIds.has(m.id))
            .map((m) => ({
              id: m.id,
              status: m.status,
              alt: m.alt,
              imageUrl: m.image?.url ?? null,
              mediaErrors: m.mediaErrors,
            }))
        : [];

      return {
        productId,
        media: created,
        userErrors,
      };
    } catch (error) {
      handleToolError("add product media", error);
    }
  },
};

export { addProductMedia };
