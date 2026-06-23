-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyCustomer" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyCustomerId" TEXT NOT NULL,
    "email" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "points" INTEGER NOT NULL DEFAULT 0,
    "lifetimePoints" INTEGER NOT NULL DEFAULT 0,
    "tier" TEXT NOT NULL DEFAULT 'bronze',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralRelationship" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "refereeId" TEXT NOT NULL,
    "referralCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "signupBonusPaid" BOOLEAN NOT NULL DEFAULT false,
    "orderBonusPaid" BOOLEAN NOT NULL DEFAULT false,
    "referrerBonusPts" INTEGER,
    "refereeBonusPts" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointTransaction" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "orderId" TEXT,
    "orderName" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedemptionVoucher" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discountAmount" DOUBLE PRECISION NOT NULL,
    "pointsUsed" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedemptionVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TierConfig" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "bronze" INTEGER NOT NULL DEFAULT 0,
    "silver" INTEGER NOT NULL DEFAULT 500,
    "gold" INTEGER NOT NULL DEFAULT 2000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TierConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltySettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "pointsPerCurrency" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "orderAmountType" TEXT NOT NULL DEFAULT 'subtotal',
    "bronzeMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "silverMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.25,
    "goldMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "bronzeRedemptionRate" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "silverRedemptionRate" DOUBLE PRECISION NOT NULL DEFAULT 80,
    "goldRedemptionRate" DOUBLE PRECISION NOT NULL DEFAULT 60,
    "voucherPreset1" INTEGER NOT NULL DEFAULT 500,
    "voucherPreset2" INTEGER NOT NULL DEFAULT 1000,
    "voucherPreset3" INTEGER NOT NULL DEFAULT 2000,
    "referralSignupBonus" INTEGER NOT NULL DEFAULT 100,
    "referralReferrerPct" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "referralRefereePct" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "accentColor" TEXT NOT NULL DEFAULT '#d4a017',
    "bgColor" TEXT NOT NULL DEFAULT '#0d0d0d',
    "textColor" TEXT NOT NULL DEFAULT '#ffffff',
    "buttonColor" TEXT NOT NULL DEFAULT '#d4a017',
    "buttonTextColor" TEXT NOT NULL DEFAULT '#0d0d0d',
    "borderRadius" INTEGER NOT NULL DEFAULT 16,
    "manualChecks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltySettings_pkey" PRIMARY KEY ("id")
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

-- AddForeignKey
ALTER TABLE "ReferralRelationship" ADD CONSTRAINT "ReferralRelationship_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "LoyaltyCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralRelationship" ADD CONSTRAINT "ReferralRelationship_refereeId_fkey" FOREIGN KEY ("refereeId") REFERENCES "LoyaltyCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "LoyaltyCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedemptionVoucher" ADD CONSTRAINT "RedemptionVoucher_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "LoyaltyCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
