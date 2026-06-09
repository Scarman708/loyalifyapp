import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getOrCreateLoyaltyCustomer } from "../services/points.server";
import { getLoyaltySettings, calculatePoints } from "../services/loyaltySettings.server";
import { evaluateAndUpdateTier } from "../services/tierService";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic, admin } = await authenticate.webhook(request);

  console.log(`[webhook] ${topic} received for shop: ${shop}`);

  const order   = payload as any;
  const orderId = String(order.id);

  // ── Find pending transaction ──────────────────────────────────────────────
  const pendingTx = await db.pointTransaction.findFirst({
    where:   { shop, orderId, status: "pending" },
    include: { customer: true },
  });

  if (pendingTx) {
    // ── Normal flow: activate the pending transaction ─────────────────────
    const { customer, points } = pendingTx;

    await db.$transaction([
      db.pointTransaction.update({
        where: { id: pendingTx.id },
        data: {
          status: "active",
          note:   pendingTx.note?.replace("pending fulfilment", "confirmed"),
        },
      }),
      db.loyaltyCustomer.update({
        where: { id: customer.id },
        data:  { points: { increment: points } },
      }),
    ]);

    console.log(`[orders-fulfilled] Activated ${points} pts for customer ${customer.shopifyCustomerId}`);

    const refreshed = await db.loyaltyCustomer.findUnique({ where: { id: customer.id } });
    if (refreshed) {
      await evaluateAndUpdateTier(
        {
          id:                refreshed.id,
          shopifyCustomerId: refreshed.shopifyCustomerId,
          shop:              refreshed.shop,
          lifetimePoints:    refreshed.lifetimePoints,
          tier:              refreshed.tier,
        },
        admin,
      );
    }

    return new Response(null, { status: 200 });
  }

  // ── No pending tx found ───────────────────────────────────────────────────
  // COD scenario: order was fulfilled before payment webhook fired,
  // OR fulfilled but payment not yet captured.
  // Only award if payment is confirmed (financial_status === "paid").

  const isPaid = order.financial_status === "paid";

  if (!isPaid) {
    console.log(`[orders-fulfilled] No pending tx and order not paid yet for ${orderId}, skipping.`);
    return new Response(null, { status: 200 });
  }

  if (!order.customer?.id) {
    console.log(`[orders-fulfilled] No pending tx and no customer for order ${orderId}, skipping.`);
    return new Response(null, { status: 200 });
  }

  // Check idempotency — maybe orders-paid already handled it as COD
  const existingActive = await db.pointTransaction.findFirst({
    where: { shop, orderId, status: "active" },
  });
  if (existingActive) {
    console.log(`[orders-fulfilled] Active transaction already exists for order ${orderId}, skipping.`);
    return new Response(null, { status: 200 });
  }

  // ── COD fallback: create and activate points now ──────────────────────────
  const shopifyCustomerId = String(order.customer.id);
  const orderName         = order.name as string;

  const settings = await getLoyaltySettings(shop);
  const customer = await getOrCreateLoyaltyCustomer(shop, shopifyCustomerId, {
    email:     order.customer.email      ?? undefined,
    firstName: order.customer.first_name ?? undefined,
    lastName:  order.customer.last_name  ?? undefined,
  });

  const orderAmount =
    settings.orderAmountType === "total"
      ? parseFloat(order.total_price    ?? "0")
      : parseFloat(order.subtotal_price ?? "0");

  const points = calculatePoints(orderAmount, customer.tier, settings);

  if (points <= 0) {
    console.log(`[orders-fulfilled] COD order ${orderName} calculated 0 points, skipping.`);
    return new Response(null, { status: 200 });
  }

  await db.$transaction([
    db.loyaltyCustomer.update({
      where: { id: customer.id },
      data: {
        lifetimePoints: { increment: points },
        points:         { increment: points },
      },
    }),
    db.pointTransaction.create({
      data: {
        shop,
        customerId: customer.id,
        type:       "earn",
        points,
        status:     "active",
        orderId,
        orderName,
        note: `Order ${orderName} — ${points} pts (COD, activated on fulfilment)`,
      },
    }),
  ]);

  console.log(`[orders-fulfilled] COD fallback — activated ${points} pts for ${shopifyCustomerId} on order ${orderName}`);

  const refreshed = await db.loyaltyCustomer.findUnique({ where: { id: customer.id } });
  if (refreshed) {
    await evaluateAndUpdateTier(
      {
        id:                refreshed.id,
        shopifyCustomerId: refreshed.shopifyCustomerId,
        shop:              refreshed.shop,
        lifetimePoints:    refreshed.lifetimePoints,
        tier:              refreshed.tier,
      },
      admin,
    );
  }

  return new Response(null, { status: 200 });
};