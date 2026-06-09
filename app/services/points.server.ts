import { PrismaClient } from "@prisma/client";
import { evaluateAndUpdateTier } from "./tierService";

const prisma = new PrismaClient();

// ── Get or create a loyalty customer record ───────────────────────────────────

export async function getOrCreateLoyaltyCustomer(
  shop: string,
  shopifyCustomerId: string | number,   // accept both, always store as string
  meta?: { email?: string; firstName?: string; lastName?: string }
) {
  const customerId = String(shopifyCustomerId);
  return prisma.loyaltyCustomer.upsert({
    where: {
      shop_shopifyCustomerId: { shop, shopifyCustomerId: customerId },
    },
    create: {
      shop,
      shopifyCustomerId: customerId,
      email:     meta?.email,
      firstName: meta?.firstName,
      lastName:  meta?.lastName,
    },
    update: {
      email:     meta?.email,
      firstName: meta?.firstName,
      lastName:  meta?.lastName,
    },
  });
}

// ── Award points ──────────────────────────────────────────────────────────────

export async function awardPoints(
  admin: any,                   // ← added: needed for tier metafield sync
  shop: string,
  shopifyCustomerId: string | number,
  points: number,
  opts: { orderId?: string; orderName?: string; note?: string } = {}
) {
  const customer = await getOrCreateLoyaltyCustomer(shop, shopifyCustomerId);

  const [updated] = await prisma.$transaction([
    prisma.loyaltyCustomer.update({
      where: { id: customer.id },
      data: {
        points:         { increment: points },
        lifetimePoints: { increment: points },
      },
    }),
    prisma.pointTransaction.create({
      data: {
        shop,
        customerId: customer.id,
        type:       "earn",
        points,
        orderId:    opts.orderId,
        orderName:  opts.orderName,
        note:       opts.note ?? `Earned ${points} points`,
      },
    }),
  ]);

  // ── Tier evaluation (no-op if tier unchanged) ─────────────────────────────
  // Runs after the DB transaction commits. Uses lifetimePoints so redemptions
  // never cause a downgrade.
  await evaluateAndUpdateTier(
    {
      id:                updated.id,
      shopifyCustomerId: updated.shopifyCustomerId,
      shop:              updated.shop,
      lifetimePoints:    updated.lifetimePoints,
      tier:              updated.tier,
    },
    admin,
  );

  return updated;
}

// ── Deduct points (redemption) ────────────────────────────────────────────────
// Intentionally does NOT call evaluateAndUpdateTier —
// tiers are based on lifetimePoints which never decreases on redemption.

export async function deductPoints(
  shop: string,
  shopifyCustomerId: string | number,
  points: number,
  opts: { note?: string } = {}
) {
  const customer = await getOrCreateLoyaltyCustomer(shop, shopifyCustomerId);

  if (customer.points < points) {
    throw new Error(
      `Insufficient points. Has ${customer.points}, needs ${points}.`
    );
  }

  const [updated] = await prisma.$transaction([
    prisma.loyaltyCustomer.update({
      where: { id: customer.id },
      data: { points: { decrement: points } },
    }),
    prisma.pointTransaction.create({
      data: {
        shop,
        customerId: customer.id,
        type:       "redeem",
        points:     -points,
        note:       opts.note ?? `Redeemed ${points} points`,
      },
    }),
  ]);

  return updated;
}

// ── Get balance + recent transactions ─────────────────────────────────────────

export async function getCustomerBalance(
  shop: string,
  shopifyCustomerId: string | number
) {
  const customerId = String(shopifyCustomerId);
  const customer = await prisma.loyaltyCustomer.findUnique({
    where: { shop_shopifyCustomerId: { shop, shopifyCustomerId: customerId } },
    include: {
      transactions: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });

  return customer ?? null;
}

// ── Sync balance to Shopify customer metafield ────────────────────────────────

export async function syncPointsMetafield(
  admin: any,
  shopifyCustomerId: string,
  points: number
) {
  const mutation = `#graphql
    mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { key namespace value }
        userErrors { field message }
      }
    }
  `;

  const response = await admin.graphql(mutation, {
    variables: {
      metafields: [
        {
          ownerId:   `gid://shopify/Customer/${shopifyCustomerId}`,
          namespace: "loyalty",
          key:       "points",
          value:     String(points),
          type:      "number_integer",
        },
      ],
    },
  });

  const result = await response.json();

  if (result.data?.metafieldsSet?.userErrors?.length > 0) {
    console.error(
      "Metafield sync errors:",
      JSON.stringify(result.data.metafieldsSet.userErrors, null, 2)
    );
  }
  if (result.errors) {
    console.error("GraphQL errors:", JSON.stringify(result.errors, null, 2));
  }

  return result;
}