// app/services/referral.server.ts

import db from "../db.server";
import { syncPointsMetafield } from "./points.server";
import { evaluateAndUpdateTier } from "./tierService";
import type { LoyaltySettingsData } from "./loyaltySettings.server";

export function generateReferralCode(shop: string, shopifyCustomerId: string): string {
  const base = `${shop}-${shopifyCustomerId}`.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return base.slice(0, 12);
}

export async function findCustomerByReferralCode(
  shop: string,
  code: string,
): Promise<{ id: string; shopifyCustomerId: string } | null> {
  const customers = await db.loyaltyCustomer.findMany({
    where:  { shop },
    select: { id: true, shopifyCustomerId: true },
  });
  return customers.find((c) => generateReferralCode(shop, c.shopifyCustomerId) === code) ?? null;
}

// ── Award signup bonus to referee ────────────────────────────────────────────
export async function awardSignupBonus(
  shop: string,
  referrerId: string,
  refereeId: string,
  referralCode: string,
  signupBonus: number,
  admin: any,                  // ← needed for metafield sync
): Promise<void> {
  if (signupBonus <= 0) return;

  await db.$transaction([
    db.loyaltyCustomer.update({
      where: { id: refereeId },
      data: { points: { increment: signupBonus }, lifetimePoints: { increment: signupBonus } },
    }),
    db.pointTransaction.create({
      data: {
        shop, customerId: refereeId,
        type: "earn", points: signupBonus, status: "active",
        note: `Referral signup bonus — ${signupBonus} pts`,
      },
    }),
    db.referralRelationship.create({
      data: { shop, referrerId, refereeId, referralCode, status: "signup_bonus_paid", signupBonusPaid: true },
    }),
  ]);

  // Sync referee's metafields + tier
  try {
    const referee = await db.loyaltyCustomer.findUnique({ where: { id: refereeId } });
    if (referee) {
      await syncPointsMetafield(admin, referee.shopifyCustomerId, referee.points);
      await evaluateAndUpdateTier({
        id: referee.id, shopifyCustomerId: referee.shopifyCustomerId,
        shop: referee.shop, lifetimePoints: referee.lifetimePoints, tier: referee.tier,
      }, admin);
    }
  } catch (e) {
    console.error("[referral] awardSignupBonus metafield sync error:", e);
  }

  console.log(`[referral] Signup bonus: ${signupBonus} pts → referee ${refereeId}`);
}

// ── Award order bonus to both parties ─────────────────────────────────────────
export async function awardOrderBonus(
  shop: string,
  referral: { id: string; referrerId: string; refereeId: string },
  baseOrderPoints: number,
  referrerPct: number,
  refereePct: number,
  admin: any,                  // ← needed for metafield sync
): Promise<void> {
  const referrerBonus = Math.floor(baseOrderPoints * (referrerPct / 100));
  const refereeBonus  = Math.floor(baseOrderPoints * (refereePct  / 100));

  const ops: any[] = [
    db.referralRelationship.update({
      where: { id: referral.id },
      data: {
        status: "completed", orderBonusPaid: true,
        referrerBonusPts: referrerBonus, refereeBonusPts: refereeBonus,
      },
    }),
  ];

  if (referrerBonus > 0) {
    ops.push(
      db.loyaltyCustomer.update({
        where: { id: referral.referrerId },
        data: { points: { increment: referrerBonus }, lifetimePoints: { increment: referrerBonus } },
      }),
      db.pointTransaction.create({
        data: {
          shop, customerId: referral.referrerId,
          type: "earn", points: referrerBonus, status: "active",
          note: `Referral bonus — your referee made their first purchase (+${referrerBonus} pts)`,
        },
      }),
    );
  }

  if (refereeBonus > 0) {
    ops.push(
      db.loyaltyCustomer.update({
        where: { id: referral.refereeId },
        data: { points: { increment: refereeBonus }, lifetimePoints: { increment: refereeBonus } },
      }),
      db.pointTransaction.create({
        data: {
          shop, customerId: referral.refereeId,
          type: "earn", points: refereeBonus, status: "active",
          note: `Referral bonus — first purchase bonus (+${refereeBonus} pts)`,
        },
      }),
    );
  }

  await db.$transaction(ops);

  // Sync metafields + tier for both parties
  try {
    const [referrer, referee] = await Promise.all([
      referrerBonus > 0 ? db.loyaltyCustomer.findUnique({ where: { id: referral.referrerId } }) : null,
      refereeBonus  > 0 ? db.loyaltyCustomer.findUnique({ where: { id: referral.refereeId  } }) : null,
    ]);

    await Promise.all([
      referrer ? syncPointsMetafield(admin, referrer.shopifyCustomerId, referrer.points) : null,
      referrer ? evaluateAndUpdateTier({
        id: referrer.id, shopifyCustomerId: referrer.shopifyCustomerId,
        shop: referrer.shop, lifetimePoints: referrer.lifetimePoints, tier: referrer.tier,
      }, admin) : null,
      referee  ? syncPointsMetafield(admin, referee.shopifyCustomerId, referee.points) : null,
      referee  ? evaluateAndUpdateTier({
        id: referee.id, shopifyCustomerId: referee.shopifyCustomerId,
        shop: referee.shop, lifetimePoints: referee.lifetimePoints, tier: referee.tier,
      }, admin) : null,
    ]);
  } catch (e) {
    console.error("[referral] awardOrderBonus metafield sync error:", e);
  }

  console.log(`[referral] Order bonus: referrer +${referrerBonus} pts, referee +${refereeBonus} pts`);
}

export async function isFirstOrder(shop: string, customerId: string): Promise<boolean> {
  const count = await db.pointTransaction.count({
    where: { shop, customerId, type: "earn", status: { in: ["active", "pending"] }, orderId: { not: null } },
  });
  return count === 0;
}