import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);
  console.log(`[webhook] ${topic} | shop: ${shop}`);

  const shopifyCustomerId = String((payload as any).customer?.id ?? "");
  const email             = (payload as any).customer?.email ?? "";

  try {
    const customer = await db.loyaltyCustomer.findUnique({
      where: { shop_shopifyCustomerId: { shop, shopifyCustomerId } },
      include: { transactions: true, vouchers: true },
    });
    // Log the data held — in production notify the merchant via email
    console.log(`[customers-data-request] Data held for ${email}:`, customer
      ? { points: customer.points, lifetimePoints: customer.lifetimePoints, tier: customer.tier,
          transactions: customer.transactions.length, vouchers: customer.vouchers.length }
      : "none");
  } catch (err) {
    console.error("[customers-data-request] Error:", err);
  }

  return new Response(null, { status: 200 });
};