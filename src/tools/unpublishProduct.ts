import type { GraphQLClient } from "graphql-request";
import { handleToolError } from "../lib/toolUtils.js";
import {
  PublishTargetInputSchema,
  changeProductPublications,
} from "../lib/publications.js";
import type { PublishTargetInput } from "../lib/publications.js";

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const unpublishProduct = {
  name: "unpublish-product",
  description: "Unpublish a product from one or more sales channels, by publicationIds or exact publicationNames (see get-publications). Returns the product's state on every channel afterwards, plus userErrors.",
  schema: PublishTargetInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: PublishTargetInput) => {
    try {
      return await changeProductPublications(shopifyClient, "unpublish", input);
    } catch (error) {
      handleToolError("unpublish product", error);
    }
  },
};

export { unpublishProduct };
