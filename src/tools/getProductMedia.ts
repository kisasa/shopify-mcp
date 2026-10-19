import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";
import { handleToolError, edgesToNodes } from "../lib/toolUtils.js";

// Input schema for getProductMedia
const GetProductMediaInputSchema = z.object({
  productId: z.string().min(1).describe("Shopify product GID (e.g. gid://shopify/Product/123)"),
});

type GetProductMediaInput = z.infer<typeof GetProductMediaInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const getProductMedia = {
  name: "get-product-media",
  description: "List a product's media with processing status (UPLOADED / PROCESSING / READY / FAILED), alt text, and image URL. Use after add-product-media to confirm processing finished.",
  schema: GetProductMediaInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: GetProductMediaInput) => {
    try {
      const query = gql`
        #graphql

        query productMedia($id: ID!) {
          product(id: $id) {
            id
            title
            media(first: 250) {
              edges {
                node {
                  id
                  alt
                  status
                  mediaContentType
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
        }
      `;

      const data = (await shopifyClient.request(query, { id: input.productId })) as {
        product: { id: string; title: string; media: any } | null;
      };

      if (!data.product) {
        throw new Error(`Failed to get product media: Product ${input.productId} not found`);
      }

      return {
        productId: data.product.id,
        title: data.product.title,
        media: edgesToNodes<any>(data.product.media).map((m) => ({
          id: m.id,
          status: m.status,
          mediaContentType: m.mediaContentType,
          alt: m.alt,
          imageUrl: m.image?.url ?? null,
          mediaErrors: m.mediaErrors,
        })),
      };
    } catch (error) {
      handleToolError("get product media", error);
    }
  },
};

export { getProductMedia };
