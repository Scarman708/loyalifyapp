/**
 * Generates a short unique referral code like REF-AB12CD34
 * Collision probability is negligible at typical loyalty program scale.
 */
export function generateReferralCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity
  let code = "REF-";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}