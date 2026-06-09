-- CreateTable
CREATE TABLE "LoyaltyCustomer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shopifyCustomerId" TEXT NOT NULL,
    "email" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "points" INTEGER NOT NULL DEFAULT 0,
    "lifetimePoints" INTEGER NOT NULL DEFAULT 0,
    "tier" TEXT NOT NULL DEFAULT 'bronze',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ReferralRelationship" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "refereeId" TEXT NOT NULL,
    "referralCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "signupBonusPaid" BOOLEAN NOT NULL DEFAULT false,
    "orderBonusPaid" BOOLEAN NOT NULL DEFAULT false,
    "referrerBonusPts" INTEGER,
    "refereeBonusPts" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReferralRelationship_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "LoyaltyCustomer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReferralRelationship_refereeId_fkey" FOREIGN KEY ("refereeId") REFERENCES "LoyaltyCustomer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PointTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "orderId" TEXT,
    "orderName" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PointTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "LoyaltyCustomer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RedemptionVoucher" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discountAmount" REAL NOT NULL,
    "pointsUsed" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RedemptionVoucher_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "LoyaltyCustomer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TierConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "bronze" INTEGER NOT NULL DEFAULT 0,
    "silver" INTEGER NOT NULL DEFAULT 500,
    "gold" INTEGER NOT NULL DEFAULT 2000,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "LoyaltySettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "pointsPerCurrency" REAL NOT NULL DEFAULT 10,
    "orderAmountType" TEXT NOT NULL DEFAULT 'subtotal',
    "bronzeMultiplier" REAL NOT NULL DEFAULT 1.0,
    "silverMultiplier" REAL NOT NULL DEFAULT 1.25,
    "goldMultiplier" REAL NOT NULL DEFAULT 1.5,
    "bronzeRedemptionRate" REAL NOT NULL DEFAULT 100,
    "silverRedemptionRate" REAL NOT NULL DEFAULT 80,
    "goldRedemptionRate" REAL NOT NULL DEFAULT 60,
    "voucherPreset1" INTEGER NOT NULL DEFAULT 500,
    "voucherPreset2" INTEGER NOT NULL DEFAULT 1000,
    "voucherPreset3" INTEGER NOT NULL DEFAULT 2000,
    "referralSignupBonus" INTEGER NOT NULL DEFAULT 100,
    "referralReferrerPct" REAL NOT NULL DEFAULT 10,
    "referralRefereePct" REAL NOT NULL DEFAULT 10,
    "accentColor" TEXT NOT NULL DEFAULT '#d4a017',
    "bgColor" TEXT NOT NULL DEFAULT '#0d0d0d',
    "textColor" TEXT NOT NULL DEFAULT '#ffffff',
    "buttonColor" TEXT NOT NULL DEFAULT '#d4a017',
    "buttonTextColor" TEXT NOT NULL DEFAULT '#0d0d0d',
    "borderRadius" INTEGER NOT NULL DEFAULT 16,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "LoyaltyCustomer_shop_idx" ON "LoyaltyCustomer"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyCustomer_shop_shopifyCustomerId_key" ON "LoyaltyCustomer"("shop", "shopifyCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralRelationship_refereeId_key" ON "ReferralRelationship"("refereeId");

-- CreateIndex
CREATE INDEX "ReferralRelationship_shop_referrerId_idx" ON "ReferralRelationship"("shop", "referrerId");

-- CreateIndex
CREATE INDEX "ReferralRelationship_referralCode_idx" ON "ReferralRelationship"("referralCode");

-- CreateIndex
CREATE INDEX "PointTransaction_shop_customerId_idx" ON "PointTransaction"("shop", "customerId");

-- CreateIndex
CREATE INDEX "RedemptionVoucher_shop_customerId_idx" ON "RedemptionVoucher"("shop", "customerId");

-- CreateIndex
CREATE INDEX "RedemptionVoucher_code_idx" ON "RedemptionVoucher"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TierConfig_shop_key" ON "TierConfig"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltySettings_shop_key" ON "LoyaltySettings"("shop");
