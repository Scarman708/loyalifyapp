import db from "../db.server";

export interface LoyaltySettingsData {
  pointsPerCurrency:    number;
  orderAmountType:      "subtotal" | "total";
  bronzeMultiplier:     number;
  silverMultiplier:     number;
  goldMultiplier:       number;
  bronzeRedemptionRate: number;
  silverRedemptionRate: number;
  goldRedemptionRate:   number;
  voucherPreset1:       number;
  voucherPreset2:       number;
  voucherPreset3:       number;
  referralSignupBonus:  number;  // pts to referee on signup
  referralReferrerPct:  number;  // % of referee's first order pts → referrer
  referralRefereePct:   number;  // % of referee's first order pts → referee (bonus)
  accentColor:          string;
  bgColor:              string;
  textColor:            string;
  buttonColor:          string;
  buttonTextColor:      string;
  borderRadius:         number;
}

const DEFAULTS: LoyaltySettingsData = {
  pointsPerCurrency:    10,
  orderAmountType:      "subtotal",
  bronzeMultiplier:     1.0,
  silverMultiplier:     1.25,
  goldMultiplier:       1.5,
  bronzeRedemptionRate: 100,
  silverRedemptionRate: 80,
  goldRedemptionRate:   60,
  voucherPreset1:       500,
  voucherPreset2:       1000,
  voucherPreset3:       2000,
  referralSignupBonus:  100,
  referralReferrerPct:  10,
  referralRefereePct:   10,
  accentColor:          "#d4a017",
  bgColor:              "#0d0d0d",
  textColor:            "#ffffff",
  buttonColor:          "#d4a017",
  buttonTextColor:      "#0d0d0d",
  borderRadius:         16,
};

export async function getLoyaltySettings(shop: string): Promise<LoyaltySettingsData> {
  const row = await db.loyaltySettings.findUnique({ where: { shop } });
  if (row) {
    return {
      pointsPerCurrency:    row.pointsPerCurrency,
      orderAmountType:      row.orderAmountType as "subtotal" | "total",
      bronzeMultiplier:     row.bronzeMultiplier,
      silverMultiplier:     row.silverMultiplier,
      goldMultiplier:       row.goldMultiplier,
      bronzeRedemptionRate: row.bronzeRedemptionRate,
      silverRedemptionRate: row.silverRedemptionRate,
      goldRedemptionRate:   row.goldRedemptionRate,
      voucherPreset1:       row.voucherPreset1,
      voucherPreset2:       row.voucherPreset2,
      voucherPreset3:       row.voucherPreset3,
      referralSignupBonus:  (row as any).referralSignupBonus  ?? DEFAULTS.referralSignupBonus,
      referralReferrerPct:  (row as any).referralReferrerPct  ?? DEFAULTS.referralReferrerPct,
      referralRefereePct:   (row as any).referralRefereePct   ?? DEFAULTS.referralRefereePct,
      accentColor:          (row as any).accentColor          ?? DEFAULTS.accentColor,
      bgColor:              (row as any).bgColor              ?? DEFAULTS.bgColor,
      textColor:            (row as any).textColor            ?? DEFAULTS.textColor,
      buttonColor:          (row as any).buttonColor          ?? DEFAULTS.buttonColor,
      buttonTextColor:      (row as any).buttonTextColor      ?? DEFAULTS.buttonTextColor,
      borderRadius:         (row as any).borderRadius         ?? DEFAULTS.borderRadius,
    };
  }
  await db.loyaltySettings.create({ data: { shop, ...DEFAULTS } });
  return DEFAULTS;
}

export async function saveLoyaltySettings(shop: string, data: LoyaltySettingsData): Promise<void> {
  await db.loyaltySettings.upsert({
    where:  { shop },
    create: { shop, ...data },
    update: data,
  });
}

export function calculatePoints(
  orderAmount: number,
  customerTier: string,
  settings: LoyaltySettingsData,
): number {
  const multiplier =
    customerTier === "gold"   ? settings.goldMultiplier :
    customerTier === "silver" ? settings.silverMultiplier :
                                settings.bronzeMultiplier;
  return Math.floor(orderAmount * settings.pointsPerCurrency * multiplier);
}

export function calculateRedemptionValue(
  points: number,
  customerTier: string,
  settings: LoyaltySettingsData,
): number {
  const rate =
    customerTier === "gold"   ? settings.goldRedemptionRate :
    customerTier === "silver" ? settings.silverRedemptionRate :
                                settings.bronzeRedemptionRate;
  return parseFloat((points / rate).toFixed(2));
}