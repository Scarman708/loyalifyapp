import type { LoaderFunctionArgs } from "react-router";
import { getCustomerBalance } from "../services/points.server";
import { getTierConfig } from "../services/tierService";
import { getLoyaltySettings, calculateRedemptionValue } from "../services/loyaltySettings.server";
import { generateReferralCode } from "../services/referral.server";
import db from "../db.server";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Content-Type": "application/json",
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const url        = new URL(request.url);
  const shop       = url.searchParams.get("shop");
  const customerId = url.searchParams.get("customerId");

  if (!shop || !customerId) return json({ error: "shop and customerId are required" }, 400);

  try {
    const enrolled = await db.loyaltyCustomer.findUnique({
      where: { shop_shopifyCustomerId: { shop, shopifyCustomerId: String(customerId) } },
    });
    if (!enrolled) return json({ enrolled: false }, 200);

    const [balance, tierConfig, settings] = await Promise.all([
      getCustomerBalance(shop, String(customerId)),
      getTierConfig(shop),
      getLoyaltySettings(shop),
    ]);

    const lifetimePoints = balance?.lifetimePoints ?? 0;
    const currentTier    = balance?.tier ?? "bronze";
    const tierProgress   = buildTierProgress(currentTier, lifetimePoints, tierConfig);

    // Active vouchers
    const now = new Date();
    const vouchers = await db.redemptionVoucher.findMany({
      where:   { shop, customerId: enrolled.id, status: "active", expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
      take:    10,
    });

    // Referral stats
    const referralCode = generateReferralCode(shop, String(customerId));
    const referralCount = await db.referralRelationship.count({
      where: { shop, referrerId: enrolled.id },
    });
    const completedReferrals = await db.referralRelationship.count({
      where: { shop, referrerId: enrolled.id, status: "completed" },
    });

    // Presets
    const presets = [settings.voucherPreset1, settings.voucherPreset2, settings.voucherPreset3].map((pts) => ({
      points:    pts,
      value:     calculateRedemptionValue(pts, currentTier, settings),
      canAfford: (balance?.points ?? 0) >= pts,
    }));

    return json({
      enrolled: true,
      customer: {
        firstName:     balance?.firstName,
        lastName:      balance?.lastName,
        email:         balance?.email,
        points:        balance?.points        ?? 0,
        lifetimePoints,
        tier:          currentTier,
      },
      tierProgress,
      transactions:      balance?.transactions ?? [],
      vouchers:          vouchers.map((v) => ({
        code: v.code, discountAmount: v.discountAmount,
        pointsUsed: v.pointsUsed, expiresAt: v.expiresAt.toISOString(),
      })),
      redemptionPresets: presets,
      referral: {
        code:               referralCode,
        totalReferrals:     referralCount,
        completedReferrals,
        signupBonus:        settings.referralSignupBonus,
        referrerPct:        settings.referralReferrerPct,
        refereePct:         settings.referralRefereePct,
      },
    }, 200);

  } catch (err: any) {
    console.error("[api.loyalty-dashboard] Error:", err);
    return json({ error: "Internal server error" }, 500);
  }
}

function buildTierProgress(
  currentTier: string,
  lifetimePoints: number,
  tierConfig: { bronze: number; silver: number; gold: number },
) {
  const tiers = [
    { name: "bronze", min: tierConfig.bronze },
    { name: "silver", min: tierConfig.silver },
    { name: "gold",   min: tierConfig.gold   },
  ];
  const idx      = tiers.findIndex((t) => t.name === currentTier);
  const nextTier = tiers[idx + 1] ?? null;
  if (!nextTier) return { currentTier, nextTier: null, pointsToNext: 0, progressPercent: 100, currentMin: tierConfig.gold, nextMin: null };
  const currentMin = tiers[idx].min;
  const nextMin    = nextTier.min;
  const progress   = Math.min(100, Math.max(0, Math.floor(((lifetimePoints - currentMin) / (nextMin - currentMin)) * 100)));
  return { currentTier, nextTier: nextTier.name, pointsToNext: Math.max(0, nextMin - lifetimePoints), progressPercent: progress, currentMin, nextMin };
}