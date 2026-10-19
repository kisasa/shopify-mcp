import type { GraphQLClient } from "graphql-request";
import { z } from "zod";
import { handleToolError } from "../lib/toolUtils.js";
import { fetchProductPublicationState } from "../lib/publications.js";

// Input schema for getProductPublications
const GetProductPublicationsInputSchema = z.object({
  productId: z.string().min(1).describe("Shopify product GID (e.g. gid://shopify/Product/123)"),
});

type GetProductPublicationsInput = z.infer<typeof GetProductPublicationsInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const getProductPublications = {
  name: "get-product-publications",
  description: "Show whether a product is published on each sales channel (published true/false, with publishDate when published or scheduled).",
  schema: GetProductPublicationsInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: GetProductPublicationsInput) => {
    try {
      return await fetchProductPublicationState(shopifyClient, input.productId);
    } catch (error) {
      handleToolError("get product publications", error);
    }
  },
};

export { getProductPublications };
