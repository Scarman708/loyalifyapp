import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getOrCreateLoyaltyCustomer } from "../services/points.server";
import { getLoyaltySettings } from "../services/loyaltySettings.server";
import { findCustomerByReferralCode, awardSignupBonus } from "../services/referral.server";
import db from "../db.server";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Content-Type": "application/json",
};

export async function loader() {
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });

  try {
    const body = await request.json();
    const { shop, customerId, email, firstName, lastName, referralCode } = body;

    if (!shop || !customerId) {
      return new Response(JSON.stringify({ error: "shop and customerId are required" }), { status: 400, headers: corsHeaders });
    }

    const existing = await db.loyaltyCustomer.findUnique({
      where: { shop_shopifyCustomerId: { shop, shopifyCustomerId: String(customerId) } },
    });
    if (existing) {
      return new Response(JSON.stringify({ success: true, alreadyEnrolled: true, customer: existing }), { status: 200, headers: corsHeaders });
    }

    const customer = await getOrCreateLoyaltyCustomer(shop, String(customerId), { email, firstName, lastName });

    // Handle referral — needs admin client for metafield sync
    if (referralCode) {
      try {
        const { unauthenticated } = await import("../shopify.server");
        const { admin } = await unauthenticated.admin(shop);

        const referrer = await findCustomerByReferralCode(shop, String(referralCode));
        if (referrer && referrer.id !== customer.id) {
          const existingReferral = await db.referralRelationship.findUnique({ where: { refereeId: customer.id } });
          if (!existingReferral) {
            const settings = await getLoyaltySettings(shop);
            await awardSignupBonus(shop, referrer.id, customer.id, String(referralCode), settings.referralSignupBonus, admin);
            console.log(`[api.loyalty-signup] Referral: ${referrer.id} → ${customer.id}`);
          }
        }
      } catch (refErr) {
        console.error("[api.loyalty-signup] Referral error (non-fatal):", refErr);
      }
    }

    return new Response(JSON.stringify({ success: true, alreadyEnrolled: false, customer }), { status: 201, headers: corsHeaders });
  } catch (err: any) {
    console.error("[api.loyalty-signup] Error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: corsHeaders });
  }
}