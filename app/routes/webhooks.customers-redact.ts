import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);
  console.log(`[webhook] ${topic} | shop: ${shop}`);

  const shopifyCustomerId = String((payload as any).customer?.id ?? "");
  if (!shopifyCustomerId) return new Response(null, { status: 200 });

  try {
    const customer = await db.loyaltyCustomer.findUnique({
      where: { shop_shopifyCustomerId: { shop, shopifyCustomerId } },
    });
    if (customer) {
      await db.$transaction([
        db.pointTransaction.deleteMany({ where: { customerId: customer.id } }),
        db.redemptionVoucher.deleteMany({ where: { customerId: customer.id } }),
        db.referralRelationship.deleteMany({
          where: { OR: [{ referrerId: customer.id }, { refereeId: customer.id }] },
        }),
        db.loyaltyCustomer.delete({ where: { id: customer.id } }),
      ]);
      console.log(`[customers-redact] Deleted data for ${shopifyCustomerId}`);
    }
  } catch (err) {
    console.error("[customers-redact] Error:", err);
  }

  return new Response(null, { status: 200 });
};