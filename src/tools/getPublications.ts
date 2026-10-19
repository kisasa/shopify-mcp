import type { GraphQLClient } from "graphql-request";
import { z } from "zod";
import { handleToolError } from "../lib/toolUtils.js";
import { fetchSalesChannels } from "../lib/publications.js";

// Input schema for getPublications (no input)
const GetPublicationsInputSchema = z.object({});

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const getPublications = {
  name: "get-publications",
  description: "List the store's sales channels (publications), e.g. Online Store and Point of Sale, with their IDs. Use the names or IDs with publish-product / unpublish-product.",
  schema: GetPublicationsInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async () => {
    try {
      const publications = await fetchSalesChannels(shopifyClient);
      return { publications };
    } catch (error) {
      handleToolError("fetch publications", error);
    }
  },
};

export { getPublications };
