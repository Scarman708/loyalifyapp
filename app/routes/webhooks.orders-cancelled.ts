import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// ── Webhook: ORDERS_CANCELLED ─────────────────────────────────────────────────
//
// Handles both cancellations and full refunds.
// - If transaction is still "pending"  → void it (mark "voided", no balance change)
// - If transaction is already "active" → deduct points and mark "deducted"
//
// lifetimePoints is also rolled back so tier calculations stay accurate.

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);

  console.log(`[webhook] ${topic} received for shop: ${shop}`);

  const order   = payload as any;
  const orderId = String(order.id);

  // ── Find ALL transactions for this order (could be pending or active) ─────
  const transactions = await db.pointTransaction.findMany({
    where:   { shop, orderId, status: { in: ["pending", "active"] } },
    include: { customer: true },
  });

  if (transactions.length === 0) {
    console.log(`[orders-cancelled] No transactions to void for order ${orderId}.`);
    return new Response(null, { status: 200 });
  }

  for (const tx of transactions) {
    const { customer, points, status } = tx;

    if (status === "pending") {
      // Never hit the spendable balance — just roll back lifetimePoints and void
      await db.$transaction([
        db.pointTransaction.update({
          where: { id: tx.id },
          data:  { status: "voided", note: `${tx.orderName} cancelled — points voided` },
        }),
        db.loyaltyCustomer.update({
          where: { id: customer.id },
          data:  { lifetimePoints: { decrement: points } },
        }),
      ]);
      console.log(`[orders-cancelled] Voided ${points} pending pts for ${customer.shopifyCustomerId}`);

    } else if (status === "active") {
      // Points were already spendable — deduct from balance AND lifetimePoints
      await db.$transaction([
        db.pointTransaction.update({
          where: { id: tx.id },
          data:  { status: "deducted", note: `${tx.orderName} cancelled — points deducted` },
        }),
        db.loyaltyCustomer.update({
          where: { id: customer.id },
          data:  {
            points:         { decrement: points },
            lifetimePoints: { decrement: points },
          },
        }),
        // Create a visible deduction record in the transaction history
        db.pointTransaction.create({
          data: {
            shop,
            customerId: customer.id,
            type:       "redeem",
            points:     -points,
            status:     "active",
            orderId,
            orderName:  tx.orderName,
            note:       `${tx.orderName} cancelled — ${points} pts reversed`,
          },
        }),
      ]);
      console.log(`[orders-cancelled] Deducted ${points} active pts for ${customer.shopifyCustomerId}`);
    }
  }

  return new Response(null, { status: 200 });
};