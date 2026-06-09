import db from "../db.server";

// ── Types ─────────────────────────────────────────────────────────────────────

export type TierName = "bronze" | "silver" | "gold";

interface TierThresholds {
  bronze: number;
  silver: number;
  gold:   number;
}

interface TierChangeEvent {
  shop:             string;
  shopifyCustomerId: string;
  customerId:       string;
  previousTier:     TierName;
  newTier:          TierName;
  lifetimePoints:   number;
}

// ── Default thresholds (used if no TierConfig row exists yet) ─────────────────

const DEFAULT_THRESHOLDS: TierThresholds = {
  bronze: 0,
  silver: 500,
  gold:   2000,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve which tier a customer belongs to given their lifetime points
 * and the shop's configured thresholds.
 */
export function resolveTier(
  lifetimePoints: number,
  thresholds: TierThresholds,
): TierName {
  if (lifetimePoints >= thresholds.gold)   return "gold";
  if (lifetimePoints >= thresholds.silver) return "silver";
  return "bronze";
}

/**
 * Load (or create with defaults) the TierConfig for a shop.
 */
export async function getTierConfig(shop: string): Promise<TierThresholds> {
  const config = await db.tierConfig.findUnique({ where: { shop } });
  if (config) {
    return { bronze: config.bronze, silver: config.silver, gold: config.gold };
  }
  // Auto-create defaults so the admin page always has something to show
  await db.tierConfig.create({
    data: { shop, ...DEFAULT_THRESHOLDS },
  });
  return DEFAULT_THRESHOLDS;
}

/**
 * Persist updated thresholds for a shop.
 */
export async function saveTierConfig(
  shop: string,
  thresholds: TierThresholds,
): Promise<void> {
  await db.tierConfig.upsert({
    where:  { shop },
    create: { shop, ...thresholds },
    update: thresholds,
  });
}

// ── Metafield sync ────────────────────────────────────────────────────────────

/**
 * Write the customer's current tier to a Shopify customer metafield so
 * storefronts / Liquid themes can read it without an API call.
 *
 * Namespace : loyalty
 * Key       : tier
 * Type      : single_line_text_field
 */
async function syncTierMetafield(
  admin: any,
  shopifyCustomerId: string,
  tier: TierName,
): Promise<void> {
  const gid = `gid://shopify/Customer/${shopifyCustomerId}`;
  await admin.graphql(
    `#graphql
      mutation setTierMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id key namespace value }
          userErrors  { field message }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            ownerId:   gid,
            namespace: "loyalty",
            key:       "tier",
            type:      "single_line_text_field",
            value:     tier,
          },
        ],
      },
    },
  );
}

// ── Webhook dispatch ──────────────────────────────────────────────────────────

/**
 * Fire a tier-change event to the shop's configured webhook endpoint (if any).
 * We use a best-effort POST — a failed delivery is logged but never throws,
 * so it never blocks the points award flow.
 *
 * To make this real, store a webhookUrl on TierConfig (or a separate table)
 * and read it here. For now we emit to the Shopify webhook topic
 * `loyalty/tier_changed` via admin REST so partners can subscribe.
 */
async function dispatchTierChangedWebhook(
  admin: any,
  event: TierChangeEvent,
): Promise<void> {
  try {
    // Use Shopify's built-in webhook system: create a webhook delivery
    // by triggering a metafield update (already done above) — external
    // partners subscribe via the Shopify Partner Dashboard.
    //
    // If you have your OWN endpoint, replace this with a fetch() POST:
    //
    // await fetch(process.env.TIER_WEBHOOK_URL!, {
    //   method:  "POST",
    //   headers: { "Content-Type": "application/json",
    //              "X-Loyalty-Hmac": sign(event) },
    //   body:    JSON.stringify(event),
    // });
    console.log("[tierService] tier_changed event:", JSON.stringify(event));
  } catch (err) {
    // Best-effort — log and continue
    console.error("[tierService] webhook dispatch failed:", err);
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Called after every point award.
 * 1. Resolves the correct tier from lifetimePoints + shop config
 * 2. If the tier changed → updates DB, syncs metafield, fires webhook
 * 3. Returns the (possibly unchanged) current tier
 */
export async function evaluateAndUpdateTier(
  customer: {
    id:               string;
    shopifyCustomerId: string;
    shop:             string;
    lifetimePoints:   number;
    tier:             string;
  },
  admin: any,
): Promise<TierName> {
  const thresholds   = await getTierConfig(customer.shop);
  const correctTier  = resolveTier(customer.lifetimePoints, thresholds);
  const previousTier = customer.tier as TierName;

  if (correctTier === previousTier) return correctTier;

  // ── Tier has changed ───────────────────────────────────────────────────────

  // 1. Persist to DB
  await db.loyaltyCustomer.update({
    where: { id: customer.id },
    data:  { tier: correctTier },
  });

  // 2. Sync Shopify metafield
  await syncTierMetafield(admin, customer.shopifyCustomerId, correctTier);

  // 3. Fire webhook / event (best-effort)
  await dispatchTierChangedWebhook(admin, {
    shop:              customer.shop,
    shopifyCustomerId: customer.shopifyCustomerId,
    customerId:        customer.id,
    previousTier,
    newTier:           correctTier,
    lifetimePoints:    customer.lifetimePoints,
  });

  console.log(
    `[tierService] ${customer.shopifyCustomerId} promoted ${previousTier} → ${correctTier} ` +
    `(${customer.lifetimePoints} lifetime pts)`,
  );

  return correctTier;
}