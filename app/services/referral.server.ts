import db from "../db.server";

// ── Generate referral code — hash based on shopifyCustomerId ──────────────
export function generateReferralCode(shop: string, shopifyCustomerId: string): string {
  const id = shopifyCustomerId.replace(/\D/g, "");
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let n = parseInt(id.slice(-10), 10) || parseInt(id, 10) || 1;
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[n % chars.length];
    n = Math.floor(n / chars.length) + (i + 1) * 7919;
  }
  return code;
}

// ── Find customer by referral code ────────────────────────────────────────
export async function findCustomerByReferralCode(
  shop: string,
  code: string,
): Promise<{ id: string; shopifyCustomerId: string } | null> {
  const customers = await db.loyaltyCustomer.findMany({
    where: { shop },
    select: { id: true, shopifyCustomerId: true },
  });

  return (
    customers.find(
      (c) => generateReferralCode(shop, c.shopifyCustomerId) === code.toUpperCase().trim()
    ) ?? null
  );
}

// ── Award signup bonus to referee ─────────────────────────────────────────
export async function awardSignupBonus(
  shop: string,
  referrerId: string,
  refereeId: string,
  referralCode: string,
  signupBonus: number,
): Promise<void> {
  if (signupBonus <= 0) return;

  await db.$transaction([
    // Award points to referee
    db.loyaltyCustomer.update({
      where: { id: refereeId },
      data: {
        points:        { increment: signupBonus },
        lifetimePoints: { increment: signupBonus },
      },
    }),
    db.pointTransaction.create({
      data: {
        shop,
        customerId: refereeId,
        type:   "earn",
        points: signupBonus,
        status: "active",
        note:   `Referral signup bonus — ${signupBonus} pts`,
      },
    }),
    // Award same points to referrer
    db.loyaltyCustomer.update({
      where: { id: referrerId },
      data: {
        points:        { increment: signupBonus },
        lifetimePoints: { increment: signupBonus },
      },
    }),
    db.pointTransaction.create({
      data: {
        shop,
        customerId: referrerId,
        type:   "earn",
        points: signupBonus,
        status: "active",
        note:   `Referral signup bonus — your referee joined (+${signupBonus} pts)`,
      },
    }),
    // Create referral relationship
    db.referralRelationship.create({
      data: {
        shop,
        referrerId,
        refereeId,
        referralCode,
        status:          "signup_bonus_paid",
        signupBonusPaid: true,
      },
    }),
  ]);

  console.log(`[referral] Signup bonus: ${signupBonus} pts → referee ${refereeId} + referrer ${referrerId}`);
}
// ── Award order bonus to both parties ────────────────────────────────────
export async function awardOrderBonus(
  shop: string,
  referral: { id: string; referrerId: string; refereeId: string },
  baseOrderPoints: number,
  referrerPct: number,
): Promise<void> {
  const referrerBonus = Math.floor(baseOrderPoints * (referrerPct / 100));

  const ops: any[] = [
    db.referralRelationship.update({
      where: { id: referral.id },
      data: {
        status:           "completed",
        orderBonusPaid:   true,
        referrerBonusPts: referrerBonus,
        refereeBonusPts:  0,
      },
    }),
  ];

  if (referrerBonus > 0) {
    ops.push(
      db.loyaltyCustomer.update({
        where: { id: referral.referrerId },
        data: {
          points:        { increment: referrerBonus },
          lifetimePoints: { increment: referrerBonus },
        },
      }),
      db.pointTransaction.create({
        data: {
          shop,
          customerId: referral.referrerId,
          type:   "earn",
          points: referrerBonus,
          status: "active",
          note:   `Referral bonus — your referee made their first purchase (+${referrerBonus} pts)`,
        },
      }),
    );
  }

  await db.$transaction(ops);
  console.log(`[referral] Order bonus: referrer +${referrerBonus} pts only`);
}
// ── Check if this is the referee's first order ────────────────────────────
export async function isFirstOrder(shop: string, customerId: string): Promise<boolean> {
  const count = await db.pointTransaction.count({
    where: {
      shop,
      customerId,
      type:    "earn",
      status:  { in: ["active", "pending"] },
      orderId: { not: null },
    },
  });
  return count === 0;
}