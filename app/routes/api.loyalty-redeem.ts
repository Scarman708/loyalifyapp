import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { getLoyaltySettings, calculateRedemptionValue } from "../services/loyaltySettings.server";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Content-Type": "application/json",
};

export async function loader() {
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body = await request.json();
    const { shop, customerId, pointsToRedeem } = body;

    if (!shop || !customerId || !pointsToRedeem) {
      return json({ error: "shop, customerId and pointsToRedeem are required" }, 400);
    }

    const points = Number(pointsToRedeem);
    if (isNaN(points) || points <= 0) {
      return json({ error: "Invalid pointsToRedeem value" }, 400);
    }

    const customer = await db.loyaltyCustomer.findUnique({
      where: { shop_shopifyCustomerId: { shop, shopifyCustomerId: String(customerId) } },
    });

    if (!customer)                return json({ error: "Customer not found" }, 404);
    if (customer.points < points) return json({ error: "Insufficient points" }, 400);

    const settings       = await getLoyaltySettings(shop);
    const discountAmount = calculateRedemptionValue(points, customer.tier, settings);
    const code           = generateCode();

    const { unauthenticated } = await import("../shopify.server");
    const { admin } = await unauthenticated.admin(shop);

    const expiresAt    = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    const expiresAtISO = expiresAt.toISOString();

    const gqlRes = await admin.graphql(`
      mutation CreateLoyaltyDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
          codeDiscountNode { id }
          userErrors { field message code }
        }
      }
    `, {
      variables: {
        basicCodeDiscount: {
          title:    `Loyalty Reward — ${code}`,
          code,
          startsAt: new Date().toISOString(),
          endsAt:   expiresAtISO,
          usageLimit: 1,
          appliesOncePerCustomer: true,
          customerSelection: { all: true },
          customerGets: {
            value: {
              discountAmount: {
                amount:            String(discountAmount),
                appliesOnEachItem: false,
              },
            },
            items: { all: true },
          },
          minimumRequirement: {
            subtotal: {
              greaterThanOrEqualToSubtotal: "1.00",
            },
          },
        },
      },
    });

    const gqlData    = await gqlRes.json();
    const userErrors = gqlData.data?.discountCodeBasicCreate?.userErrors ?? [];

    if (userErrors.length > 0) {
      console.error("[api.loyalty-redeem] Shopify userErrors:", userErrors);
      return json({ error: "Failed to create discount code", details: userErrors }, 500);
    }

    await db.$transaction([
      db.loyaltyCustomer.update({
        where: { id: customer.id },
        data:  { points: { decrement: points } },
      }),
      db.pointTransaction.create({
        data: {
          shop,
          customerId: customer.id,
          type:       "redeem",
          points:     -points,
          status:     "active",
          note:       `Redeemed ${points} pts → ${discountAmount} voucher (${code})`,
        },
      }),
      db.redemptionVoucher.create({
        data: {
          shop,
          customerId:     customer.id,
          code,
          discountAmount,
          pointsUsed:     points,
          status:         "active",
          expiresAt,
        },
      }),
    ]);

    console.log(`[api.loyalty-redeem] ${customer.shopifyCustomerId} redeemed ${points} pts → ${discountAmount} (${code})`);

    const updated = await db.loyaltyCustomer.findUnique({ where: { id: customer.id } });

    return json({
      success:        true,
      code,
      discountAmount,
      pointsUsed:     points,
      expiresAt:      expiresAtISO,
      newBalance:     updated?.points ?? (customer.points - points),
    }, 201);

  } catch (err: any) {
    console.error("[api.loyalty-redeem] Error:", err);
    return json({ error: "Internal server error" }, 500);
  }
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

function generateCode(): string {
  const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
  const ts   = Date.now().toString(36).toUpperCase().slice(-4);
  return `LYL-${rand}${ts}`;
}