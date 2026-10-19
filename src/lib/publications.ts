import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";
import { edgesToNodes } from "./toolUtils.js";
import type { ShopifyUserError } from "./toolUtils.js";

// ── Sales-channel publications ────────────────────────────────────────
//
// Sales channels are publications whose catalog is an AppCatalog (catalogType APP).
// Market and B2B catalogs are also publications, but are excluded here so that
// channel lookups, name resolution, and product state all use the same set.
// Product.resourcePublicationsV2 defaults to APP catalogs too, which keeps the
// published/unpublished state consistent with this list.

export interface SalesChannel {
  id: string;
  name: string;
  autoPublish: boolean;
  supportsFuturePublishing: boolean;
}

export interface ProductPublicationState {
  publicationId: string;
  name: string;
  published: boolean;
  publishDate: string | null;
}

/** Fetch every sales-channel publication on the store (paginated). */
export async function fetchSalesChannels(client: GraphQLClient): Promise<SalesChannel[]> {
  const query = gql`
    #graphql

    query salesChannels($after: String) {
      publications(first: 250, after: $after, catalogType: APP) {
        edges {
          node {
            id
            name
            autoPublish
            supportsFuturePublishing
            catalog {
              title
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const channels: SalesChannel[] = [];
  let after: string | undefined;
  do {
    const data = (await client.request(query, { after })) as {
      publications: { edges: any[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
    };
    for (const p of edgesToNodes<any>({ edges: data.publications.edges })) {
      channels.push({
        id: p.id,
        // Publication.name is deprecated in favour of Catalog.title; fall back if no catalog
        name: p.catalog?.title ?? p.name,
        autoPublish: p.autoPublish,
        supportsFuturePublishing: p.supportsFuturePublishing,
      });
    }
    after = data.publications.pageInfo.hasNextPage
      ? data.publications.pageInfo.endCursor ?? undefined
      : undefined;
  } while (after);

  return channels;
}

/**
 * The product's state on every sales channel. resourcePublicationsV2 only lists
 * publications the product is published or staged on, so channels missing from
 * it are reported as unpublished.
 */
export async function fetchProductPublicationState(
  client: GraphQLClient,
  productId: string,
  channels?: SalesChannel[],
): Promise<{ productId: string; title: string; publications: ProductPublicationState[] }> {
  const query = gql`
    #graphql

    query productPublicationState($id: ID!) {
      product(id: $id) {
        id
        title
        resourcePublicationsV2(first: 250, onlyPublished: false) {
          edges {
            node {
              isPublished
              publishDate
              publication {
                id
              }
            }
          }
        }
      }
    }
  `;

  const [allChannels, data] = await Promise.all([
    channels ?? fetchSalesChannels(client),
    client.request(query, { id: productId }) as Promise<{
      product: { id: string; title: string; resourcePublicationsV2: any } | null;
    }>,
  ]);

  if (!data.product) {
    throw new Error(`Failed to get product publications: Product ${productId} not found`);
  }

  const byPublication = new Map(
    edgesToNodes<any>(data.product.resourcePublicationsV2).map((rp) => [rp.publication.id, rp]),
  );

  return {
    productId: data.product.id,
    title: data.product.title,
    publications: allChannels.map((c) => {
      const rp = byPublication.get(c.id);
      return {
        publicationId: c.id,
        name: c.name,
        published: rp?.isPublished ?? false,
        publishDate: rp?.publishDate ?? null,
      };
    }),
  };
}

/** Shared input for publish-product / unpublish-product. */
export const PublishTargetInputSchema = z.object({
  productId: z.string().min(1).describe("Shopify product GID (e.g. gid://shopify/Product/123)"),
  publicationIds: z.array(z.string().min(1)).min(1).optional()
    .describe("Publication GIDs (from get-publications). Provide this OR publicationNames."),
  publicationNames: z.array(z.string().min(1)).min(1).optional()
    .describe("Sales channel names exactly as returned by get-publications, e.g. [\"Online Store\", \"Point of Sale\"]. Provide this OR publicationIds."),
});

export type PublishTargetInput = z.infer<typeof PublishTargetInputSchema>;

/**
 * Resolve publication IDs from either explicit IDs or channel names.
 * Each name must match exactly one sales channel.
 */
export function resolvePublicationIds(
  input: PublishTargetInput,
  channels: SalesChannel[],
): string[] {
  const { publicationIds, publicationNames } = input;
  if (!!publicationIds === !!publicationNames) {
    throw new Error("Provide exactly one of publicationIds or publicationNames");
  }
  if (publicationIds) return publicationIds;

  return publicationNames!.map((name) => {
    const matches = channels.filter((c) => c.name === name);
    if (matches.length !== 1) {
      const available = channels.map((c) => `"${c.name}"`).join(", ");
      throw new Error(
        matches.length === 0
          ? `No sales channel named "${name}". Available: ${available}`
          : `"${name}" matches ${matches.length} sales channels; use publicationIds instead (${matches.map((c) => c.id).join(", ")})`,
      );
    }
    return matches[0].id;
  });
}

/** Run publishablePublish / publishableUnpublish and return the resulting state plus userErrors. */
export async function changeProductPublications(
  client: GraphQLClient,
  mode: "publish" | "unpublish",
  input: PublishTargetInput,
) {
  const channels = await fetchSalesChannels(client);
  const publicationIds = resolvePublicationIds(input, channels);

  const mutation =
    mode === "publish"
      ? gql`
          #graphql

          mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
            publishablePublish(id: $id, input: $input) {
              userErrors {
                field
                message
              }
            }
          }
        `
      : gql`
          #graphql

          mutation publishableUnpublish($id: ID!, $input: [PublicationInput!]!) {
            publishableUnpublish(id: $id, input: $input) {
              userErrors {
                field
                message
              }
            }
          }
        `;

  const field = mode === "publish" ? "publishablePublish" : "publishableUnpublish";
  const data = (await client.request(mutation, {
    id: input.productId,
    input: publicationIds.map((publicationId) => ({ publicationId })),
  })) as Record<string, { userErrors: ShopifyUserError[] }>;

  const state = await fetchProductPublicationState(client, input.productId, channels);

  return {
    ...state,
    userErrors: data[field].userErrors,
  };
}
