import { useLoaderData, useFetcher } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

declare global {
  namespace JSX { interface IntrinsicElements { [elemName: string]: any; } }
}

type TierName = "Bronze" | "Silver" | "Gold";

// ── Loader ────────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [allCustomersRaw, transactions30d, recentRaw] = await Promise.all([
    db.loyaltyCustomer.findMany({
      where: {
        shop,
      },
      orderBy: {
        lifetimePoints: "desc",
      },
      select: {
        id: true,
        shopifyCustomerId: true,
        points: true,
        lifetimePoints: true,
        tier: true,
        firstName: true,
        lastName: true,
        email: true,
        createdAt: true,
        // Include transactions and vouchers so the modal has real data
        transactions: {
          where: {
            shop,
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true, type: true, points: true, note: true,
            status: true, createdAt: true, orderName: true,
          },
        },
        vouchers: {
          where: {
    shop,
  },
          select: {
            id: true, code: true, discountAmount: true,
            pointsUsed: true, status: true, expiresAt: true,
          },
        },
      },
    }),
    db.pointTransaction.findMany({
      where: { shop, createdAt: { gte: thirtyDaysAgo } },
      select: { type: true, points: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    db.pointTransaction.findMany({
      where: {
        shop,
      },
      take: 10,
      orderBy: { createdAt: "desc" },
      select: {
        id: true, customerId: true, type: true, points: true, note: true, createdAt: true,
        customer: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  const totalMembers = allCustomersRaw.length;
  const newMembers30d = allCustomersRaw.filter((c) => c.createdAt >= thirtyDaysAgo).length;
  const outstandingBalance = allCustomersRaw.reduce((s, c) => s + c.points, 0);

  let pointsIssued30d = 0, pointsRedeemed30d = 0;
  for (const t of transactions30d) {
    if (t.type === "earn" || t.type === "adjust") pointsIssued30d += t.points;
    else pointsRedeemed30d += t.points;
  }

  const topCustomers = allCustomersRaw.slice(0, 5).map((c) => ({
    shopifyCustomerId: c.shopifyCustomerId,
    totalPoints: c.points,
    name: [c.firstName, c.lastName].filter(Boolean).join(" ") || null,
  }));

  const dayMap = new Map<string, { issued: number; redeemed: number }>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    dayMap.set(d.toISOString().slice(0, 10), { issued: 0, redeemed: 0 });
  }
  for (const t of transactions30d) {
    const key = t.createdAt.toISOString().slice(0, 10);
    const entry = dayMap.get(key); if (!entry) continue;
    if (t.type === "earn" || t.type === "adjust") entry.issued += t.points;
    else entry.redeemed += t.points;
  }
  const dailyStats = Array.from(dayMap.entries()).map(([date, v]) => ({ date, ...v }));

  const tierCounts = { Gold: 0, Silver: 0, Bronze: 0 };
  for (const c of allCustomersRaw) {
    const t = c.lifetimePoints >= 2000 ? "Gold" : c.lifetimePoints >= 500 ? "Silver" : "Bronze";
    tierCounts[t]++;
  }
  const tierStats = [
    { tier: "Gold" as TierName, count: tierCounts.Gold, threshold: "≥ 2,000 pts" },
    { tier: "Silver" as TierName, count: tierCounts.Silver, threshold: "500–1,999 pts" },
    { tier: "Bronze" as TierName, count: tierCounts.Bronze, threshold: "< 500 pts" },
  ];

  const recentTransactions = recentRaw.map((t) => ({
    id: t.id, customerId: t.customerId, type: t.type as any,
    points: t.points, note: t.note, createdAt: t.createdAt,
    customerName: t.customer
      ? [t.customer.firstName, t.customer.lastName].filter(Boolean).join(" ") || null
      : null,
  }));

  // Strip nested relations for the table-level data to keep payload lighter,
  // but keep full data (with transactions + vouchers) for the modal.
  const allCustomers = allCustomersRaw.map((c) => ({
    id: c.id,
    shopifyCustomerId: c.shopifyCustomerId,
    points: c.points,
    lifetimePoints: c.lifetimePoints,
    tier: c.tier,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    createdAt: c.createdAt,
    transactions: c.transactions,
    vouchers: c.vouchers,
  }));

  return {
    totalMembers, newMembers30d, pointsIssued30d, pointsRedeemed30d,
    outstandingBalance, topCustomers, recentTransactions, dailyStats, tierStats,
    allCustomers,
  };
};

// ── Action (point adjustments) ────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const raw = await request.json();
  const { intent, customerId, points, note } = raw;

  const customer = await db.loyaltyCustomer.findUnique({ where: { id: customerId } });
  if (!customer || customer.shop !== shop) return { ok: false, error: "Customer not found" };

  const pts = Number(points);
  if (isNaN(pts) || pts <= 0) return { ok: false, error: "Points must be a positive number" };

  if (intent === "add") {
    await db.$transaction([
      db.loyaltyCustomer.update({
        where: { id: customerId },
        data: { points: { increment: pts }, lifetimePoints: { increment: pts } },
      }),
      db.pointTransaction.create({
        data: {
          shop, customerId, type: "adjust", points: pts, status: "active",
          note: note || `Manual adjustment by merchant (+${pts} pts)`
        },
      }),
    ]);
    const updated = await db.loyaltyCustomer.findUnique({ where: { id: customerId } });
    if (updated) {
      try {
        const { syncPointsMetafield } = await import("../services/points.server");
        const { evaluateAndUpdateTier } = await import("../services/tierService");
        await syncPointsMetafield(admin, updated.shopifyCustomerId, updated.points);
        await evaluateAndUpdateTier({
          id: updated.id, shopifyCustomerId: updated.shopifyCustomerId,
          shop: updated.shop, lifetimePoints: updated.lifetimePoints, tier: updated.tier
        }, admin);
      } catch (e) { console.error("[analytics/action] sync error:", e); }
    }
    return { ok: true, intent, pts, customerId };
  }

  if (intent === "deduct") {
    if (customer.points < pts) return { ok: false, error: `Customer only has ${customer.points} points` };
    await db.$transaction([
      db.loyaltyCustomer.update({ where: { id: customerId }, data: { points: { decrement: pts } } }),
      db.pointTransaction.create({
        data: {
          shop, customerId, type: "adjust", points: -pts, status: "active",
          note: note || `Manual deduction by merchant (−${pts} pts)`
        },
      }),
    ]);
    const updated = await db.loyaltyCustomer.findUnique({ where: { id: customerId } });
    if (updated) {
      try {
        const { syncPointsMetafield } = await import("../services/points.server");
        await syncPointsMetafield(admin, updated.shopifyCustomerId, updated.points);
      } catch (e) { console.error("[analytics/action] sync error:", e); }
    }
    return { ok: true, intent, pts, customerId };
  }

  return { ok: false, error: "Unknown intent" };
};

// ── Icons (line icons, 1.5px stroke, replace all emoji) ───────────────────────

type IconProps = { size?: number; color?: string };

const IconUsers = ({ size = 20, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7.5" cy="6.5" r="2.75" />
    <path d="M2.5 16c.55-3 2.4-4.75 5-4.75s4.45 1.75 5 4.75" />
    <path d="M13.2 4.3a2.6 2.6 0 0 1 0 4.9" />
    <path d="M14.5 11.4c1.9.4 3.2 1.8 3.8 4.6" />
  </svg>
);

const IconArrowUp = ({ size = 12, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9.5V2.5M2.7 5.6 6 2.3l3.3 3.3" />
  </svg>
);

const IconArrowDown = ({ size = 12, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2.5v7M2.7 6.4 6 9.7l3.3-3.3" />
  </svg>
);

const IconCoins = ({ size = 20, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="7.5" cy="6" rx="5" ry="2.5" />
    <path d="M2.5 6v4c0 1.4 2.24 2.5 5 2.5s5-1.1 5-2.5V6" />
    <path d="M2.5 10v4c0 1.4 2.24 2.5 5 2.5.62 0 1.2-.05 1.75-.15" />
    <path d="M13 9.3c2.55.2 4.5 1.2 4.5 2.45 0 1.05-1.4 1.95-3.35 2.3" />
  </svg>
);

const IconWallet = ({ size = 20, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2.5" y="5.5" width="15" height="10.5" rx="2" />
    <path d="M2.5 8.5h15" />
    <circle cx="13.5" cy="12" r="1.1" fill={color} stroke="none" />
  </svg>
);

const IconChart = ({ size = 20, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v12.5c0 .55.45 1 1 1h13" />
    <path d="M6 13.5V9.5M10 13.5V6M14 13.5v-5" />
  </svg>
);

const IconSearch = ({ size = 16, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7" cy="7" r="4.5" />
    <path d="m13.2 13.2-2.8-2.8" />
  </svg>
);

const IconEdit = ({ size = 14, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.7 2.7a1.5 1.5 0 0 1 2.1 2.1L5.4 12.3l-2.9.7.7-2.9 7.5-7.4Z" />
  </svg>
);

const IconEye = ({ size = 14, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.5 8S3.8 3.3 8 3.3 14.5 8 14.5 8 12.2 12.7 8 12.7 1.5 8 1.5 8Z" />
    <circle cx="8" cy="8" r="1.9" />
  </svg>
);

const IconClose = ({ size = 16, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round">
    <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
  </svg>
);

const IconPlus = ({ size = 14, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round">
    <path d="M8 3v10M3 8h10" />
  </svg>
);

const IconMinus = ({ size = 14, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round">
    <path d="M3 8h10" />
  </svg>
);

const IconCheckCircle = ({ size = 16, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="6.5" />
    <path d="M5.2 8.2 7.1 10l3.7-4" />
  </svg>
);

const IconAlert = ({ size = 16, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 1.6 14.8 13.4a1 1 0 0 1-.87 1.5H2.07a1 1 0 0 1-.87-1.5L8 1.6Z" />
    <path d="M8 6.4v3.2" />
    <circle cx="8" cy="11.8" r="0.15" fill={color} />
  </svg>
);

const IconChevronLeft = ({ size = 14, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 3 5 8l5 5" />
  </svg>
);

const IconChevronRight = ({ size = 14, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 3l5 5-5 5" />
  </svg>
);

const IconMedal = ({ size = 14, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="9.8" r="4.2" />
    <path d="M6 6.3 4.3 1.6h2.2L8 4.9l1.5-3.3h2.2L10 6.3" />
    <path d="M8 7.7v4.1" />
  </svg>
);

const IconReceipt = ({ size = 15, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3.5 1.5h9v13l-1.6-1-1.6 1-1.6-1-1.6 1-1.6-1-1 1v-13Z" />
    <path d="M5.5 5h6M5.5 8h6M5.5 11h3.5" />
  </svg>
);

// Empty-state illustration: a simple open tray, reused across empty lists/tables
const EmptyIllustration = ({ size = 56 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    <rect x="10" y="14" width="44" height="30" rx="4" stroke="#C9CCD1" strokeWidth="2" />
    <path d="M10 30h11l3.5 6h15L43 30h11" stroke="#C9CCD1" strokeWidth="2" strokeLinejoin="round" />
    <circle cx="32" cy="50" r="1.6" fill="#DFE1E4" />
    <circle cx="24" cy="52" r="1.2" fill="#DFE1E4" />
    <circle cx="40" cy="52" r="1.2" fill="#DFE1E4" />
  </svg>
);

// ── Design tokens (Polaris-aligned) ───────────────────────────────────────────

const COLOR = {
  text: "#1A1C1D",
  textSecondary: "#616669",
  textTertiary: "#8A8F93",
  border: "#E3E5E7",
  borderSubtle: "#EDEEEF",
  surface: "#FFFFFF",
  surfaceSubtle: "#F7F7F8",
  success: "#008060",
  successBg: "#E3F6ED",
  critical: "#D82C0D",
  criticalBg: "#FCEBE9",
  accent: "#2C6ECB",
  accentBg: "#EDF3FC",
};

const cardShell: React.CSSProperties = {
  background: COLOR.surface,
  border: `1px solid ${COLOR.border}`,
  borderRadius: "10px",
  boxShadow: "0 1px 2px rgba(26,28,29,0.04)",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const TIER_STYLES: Record<string, { bg: string; text: string; border: string; bar: string }> = {
  bronze: { bg: "#FBF0E8", text: "#9C5A25", border: "#EFCDAE", bar: "#C97B3C" },
  silver: { bg: "#F1F2F4", text: "#54595D", border: "#D4D7DB", bar: "#8A9099" },
  gold: { bg: "#FCF3DC", text: "#8A6116", border: "#EFD895", bar: "#C9971F" },
};

function TierBadge({ tier }: { tier: string }) {
  const c = TIER_STYLES[tier] ?? TIER_STYLES.bronze;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "4px",
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
      borderRadius: "999px", padding: "2px 10px 2px 8px", fontSize: "12px", fontWeight: 600,
      textTransform: "capitalize", whiteSpace: "nowrap"
    }}>
      <IconMedal size={12} color={c.text} /> {tier}
    </span>
  );
}

function fmtNum(n: number) { return n.toLocaleString(); }

function relativeTime(date: any) {
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
  if (diff < 1) return "just now";
  if (diff < 60) return `${diff}m ago`;
  const h = Math.floor(diff / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function initials(name: string | null, id: string) {
  if (name) {
    const p = name.trim().split(/\s+/);
    return p.length >= 2 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : p[0].slice(0, 2).toUpperCase();
  }
  return id.slice(0, 2).toUpperCase();
}

function formatDate(d: any) {
  return new Date(d).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
}

function txBadge(type: string, status: string) {
  if (status === "pending") return { label: "Pending", bg: "#FFF4E4", color: "#8A5C00" };
  if (status === "voided") return { label: "Voided", bg: COLOR.criticalBg, color: "#9C2A11" };
  if (status === "deducted") return { label: "Deducted", bg: COLOR.criticalBg, color: "#9C2A11" };
  if (type === "earn") return { label: "Earned", bg: COLOR.successBg, color: "#00512F" };
  if (type === "redeem") return { label: "Redeemed", bg: "#F1EBFB", color: "#5C3EBF" };
  if (type === "adjust") return { label: "Adjusted", bg: COLOR.accentBg, color: "#1F4E93" };
  return { label: type, bg: "#F1F2F4", color: "#54595D" };
}

const inp: React.CSSProperties = {
  padding: "8px 12px", border: `1px solid ${COLOR.border}`, borderRadius: "8px", fontSize: "14px",
  color: COLOR.text, outline: "none",
};

// Small empty-state block reused across list-style sections
function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "28px 16px", textAlign: "center", gap: "10px" }}>
      <EmptyIllustration size={48} />
      <div style={{ fontSize: "13px", fontWeight: 600, color: COLOR.text }}>{title}</div>
      {subtitle && <div style={{ fontSize: "12.5px", color: COLOR.textTertiary, maxWidth: "220px" }}>{subtitle}</div>}
    </div>
  );
}

// ── Customer Detail Modal ─────────────────────────────────────────────────────

function CustomerModal({
  customer, onClose, fetcher,
}: {
  customer: any;
  onClose: () => void;
  fetcher: any;
}) {
  const [tab, setTab] = useState<"overview" | "transactions" | "vouchers">("overview");
  const [adjustTab, setAdjustTab] = useState<"add" | "deduct">("add");
  const [adjustPts, setAdjustPts] = useState("");
  const [adjustNote, setAdjustNote] = useState("");

  const isSaving = fetcher.state !== "idle";
  const result = fetcher.data as any;
  const myResult = result?.customerId === customer.id ? result : null;

  // Optimistic balance
  const currentPts = (() => {
    if (!myResult?.ok) return customer.points;
    return myResult.intent === "add"
      ? customer.points + myResult.pts
      : customer.points - myResult.pts;
  })();

  const handleAdjust = () => {
    if (!adjustPts) return;
    fetcher.submit(
      { intent: adjustTab, customerId: customer.id, points: Number(adjustPts), note: adjustNote },
      { method: "POST", encType: "application/json" },
    );
    setAdjustPts(""); setAdjustNote("");
  };

  const activeVouchers = (customer.vouchers ?? []).filter(
    (v: any) => v.status === "active" && new Date(v.expiresAt) > new Date()
  );

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(26,28,29,0.45)", display: "flex", alignItems: "flex-start",
      justifyContent: "flex-end",
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{
        width: "500px", maxWidth: "100vw", height: "100vh", background: COLOR.surface,
        overflowY: "auto", display: "flex", flexDirection: "column",
        boxShadow: "-8px 0 32px rgba(26,28,29,0.16)",
      }}>
        {/* Header */}
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${COLOR.borderSubtle}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "3px", color: COLOR.text }}>
              {customer.firstName || customer.lastName
                ? `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim()
                : "No name"}
            </div>
            <div style={{ fontSize: "13px", color: COLOR.textSecondary }}>{customer.email ?? "No email"}</div>
            <div style={{ fontSize: "11px", color: COLOR.textTertiary, marginTop: "2px" }}>ID: {customer.shopifyCustomerId}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <TierBadge tier={customer.tier} />
            <button onClick={onClose} aria-label="Close"
              style={{ background: "none", border: "none", cursor: "pointer", color: COLOR.textSecondary, padding: "4px", display: "flex", borderRadius: "6px" }}>
              <IconClose size={16} />
            </button>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: "flex", borderBottom: `1px solid ${COLOR.borderSubtle}` }}>
          {[
            { label: "Available", value: fmtNum(currentPts), accent: true },
            { label: "Lifetime", value: fmtNum(customer.lifetimePoints) },
            { label: "Member since", value: formatDate(customer.createdAt) },
          ].map(({ label, value, accent }) => (
            <div key={label} style={{ flex: 1, padding: "12px 16px", borderRight: `1px solid ${COLOR.borderSubtle}` }}>
              <div style={{ fontSize: "11px", color: COLOR.textTertiary, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "4px", fontWeight: 600 }}>{label}</div>
              <div style={{ fontSize: "17px", fontWeight: 700, color: accent ? COLOR.accent : COLOR.text }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: `1px solid ${COLOR.borderSubtle}` }}>
          {(["overview", "transactions", "vouchers"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: "10px 0", fontSize: "13px", fontWeight: tab === t ? 600 : 500,
              color: tab === t ? COLOR.text : COLOR.textTertiary, background: "none", border: "none",
              borderBottom: `2px solid ${tab === t ? COLOR.text : "transparent"}`,
              marginBottom: "-1px", cursor: "pointer", textTransform: "capitalize",
            }}>{t}</button>
          ))}
        </div>

        <div style={{ padding: "18px 22px", flex: 1 }}>

          {/* ── Overview tab ── */}
          {tab === "overview" && (
            <div>
              <div style={{ fontWeight: 600, fontSize: "13.5px", marginBottom: "12px", color: COLOR.text }}>Adjust points</div>

              {myResult?.ok === true && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", background: COLOR.successBg, border: "1px solid #B7E3CD", borderRadius: "8px", padding: "9px 12px", marginBottom: "12px", fontSize: "13px", color: "#00512F" }}>
                  <IconCheckCircle size={15} color="#00512F" />
                  {myResult.intent === "add" ? `+${myResult.pts}` : `−${myResult.pts}`} points applied.
                </div>
              )}
              {myResult?.ok === false && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", background: COLOR.criticalBg, border: "1px solid #F3B7AC", borderRadius: "8px", padding: "9px 12px", marginBottom: "12px", fontSize: "13px", color: "#9C2A11" }}>
                  <IconAlert size={15} color="#9C2A11" />
                  {myResult.error}
                </div>
              )}

              <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
                {(["add", "deduct"] as const).map((t) => (
                  <button key={t} onClick={() => setAdjustTab(t)} style={{
                    display: "flex", alignItems: "center", gap: "6px",
                    padding: "7px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
                    cursor: "pointer", border: "1px solid",
                    borderColor: adjustTab === t ? (t === "add" ? "#B7E3CD" : "#F3B7AC") : COLOR.border,
                    background: adjustTab === t ? (t === "add" ? COLOR.successBg : COLOR.criticalBg) : COLOR.surface,
                    color: adjustTab === t ? (t === "add" ? "#00512F" : "#9C2A11") : COLOR.textSecondary,
                  }}>
                    {t === "add" ? <IconPlus size={12} /> : <IconMinus size={12} />}
                    {t === "add" ? "Add" : "Deduct"}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div>
                  <div style={{ fontSize: "12px", color: COLOR.textSecondary, marginBottom: "4px", fontWeight: 500 }}>Points</div>
                  <input type="number" min={1} value={adjustPts} onChange={(e) => setAdjustPts(e.target.value)}
                    placeholder="e.g. 100" style={{ ...inp, width: "140px" }} />
                </div>
                <div>
                  <div style={{ fontSize: "12px", color: COLOR.textSecondary, marginBottom: "4px", fontWeight: 500 }}>Note (optional)</div>
                  <input type="text" value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)}
                    placeholder="Reason for adjustment…" style={{ ...inp, width: "100%", boxSizing: "border-box" }} />
                </div>
                <div>
                  <s-button variant={adjustTab === "add" ? "primary" : "secondary"}
                    onClick={handleAdjust} disabled={!adjustPts || isSaving}
                    {...(isSaving ? { loading: true } : {})}>
                    {isSaving ? "Saving…" : adjustTab === "add" ? "Add points" : "Deduct points"}
                  </s-button>
                </div>
              </div>
            </div>
          )}

          {/* ── Transactions tab ── */}
          {tab === "transactions" && (
            <div>
              {(!customer.transactions || customer.transactions.length === 0) ? (
                <EmptyState title="No transactions yet" subtitle="Point activity for this customer will show up here." />
              ) : (
                <div style={{ border: `1px solid ${COLOR.borderSubtle}`, borderRadius: "8px", overflow: "hidden" }}>
                  {customer.transactions.map((tx: any, i: number) => {
                    const badge = txBadge(tx.type, tx.status);
                    return (
                      <div key={tx.id} style={{
                        display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px",
                        borderTop: i === 0 ? "none" : `1px solid ${COLOR.borderSubtle}`,
                        background: i % 2 === 0 ? COLOR.surface : COLOR.surfaceSubtle,
                      }}>
                        <span style={{
                          background: badge.bg, color: badge.color, borderRadius: "999px",
                          padding: "2px 8px", fontSize: "11px", fontWeight: 600, flexShrink: 0
                        }}>
                          {badge.label}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "13px", color: "#333", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {tx.note ?? (tx.orderName ? `Order ${tx.orderName}` : tx.type)}
                          </div>
                          <div style={{ fontSize: "11px", color: COLOR.textTertiary }}>{formatDate(tx.createdAt)}</div>
                        </div>
                        <div style={{ fontSize: "13px", fontWeight: 700, flexShrink: 0, color: tx.points > 0 ? COLOR.success : COLOR.critical }}>
                          {tx.points > 0 ? "+" : ""}{fmtNum(tx.points)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Vouchers tab ── */}
          {tab === "vouchers" && (
            <div>
              {activeVouchers.length === 0 ? (
                <EmptyState title="No active vouchers" subtitle="Redeemed vouchers that are still valid will appear here." />
              ) : (
                activeVouchers.map((v: any) => (
                  <div key={v.id} style={{ background: COLOR.surfaceSubtle, border: `1px solid ${COLOR.borderSubtle}`, borderRadius: "8px", padding: "14px 16px", marginBottom: "10px" }}>
                    <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: "15px", color: COLOR.accent, marginBottom: "4px" }}>{v.code}</div>
                    <div style={{ fontSize: "13px", color: "#555" }}>{v.discountAmount} off · {v.pointsUsed} pts used</div>
                    <div style={{ fontSize: "11px", color: COLOR.textTertiary, marginTop: "2px" }}>Expires {formatDate(v.expiresAt)}</div>
                  </div>
                ))
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ── KPI Card ───────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon, tint,
}: {
  label: string; value: string; sub: string;
  icon: React.ReactNode; tint: { bg: string; fg: string };
}) {
  return (
    <div style={{ ...cardShell, padding: "16px 18px", display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: "12.5px", fontWeight: 600, color: COLOR.textSecondary, textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</div>
        <div style={{ width: "30px", height: "30px", borderRadius: "8px", background: tint.bg, color: tint.fg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {icon}
        </div>
      </div>
      <div style={{ fontSize: "28px", fontWeight: 700, color: COLOR.text, letterSpacing: "-0.01em", lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: "12.5px", color: COLOR.textTertiary }}>{sub}</div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const [searchQ, setSearchQ] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [detailCustomer, setDetailCustomer] = useState<any>(null);
  const [page, setPage] = useState(0);

  const PAGE_SIZE = 10;

  const filtered = data.allCustomers.filter((c) => {
    if (!searchQ) return true;
    const q = searchQ.toLowerCase();
    return (
      c.email?.toLowerCase().includes(q) ||
      c.firstName?.toLowerCase().includes(q) ||
      c.lastName?.toLowerCase().includes(q) ||
      c.shopifyCustomerId.includes(q)
    );
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageCustomers = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Opens the modal with the full customer object (transactions + vouchers already included from loader)
  const openDetail = (c: any) => {
    setSelectedCustomer(c);
    setDetailCustomer(c);
  };

  const totalForTier = data.tierStats.reduce((s, t) => s + t.count, 0) || 1;

  const chartDays = data.dailyStats.filter((_, i) => i % 2 === 0).map((d) => { const [, m, day] = d.date.split("-"); return `${parseInt(m)}/${parseInt(day)}`; });
  const chartIssued = data.dailyStats.filter((_, i) => i % 2 === 0).map((d) => d.issued);
  const chartRedeemed = data.dailyStats.filter((_, i) => i % 2 === 0).map((d) => d.redeemed);
  const hasChartActivity = data.pointsIssued30d > 0 || data.pointsRedeemed30d > 0;

  return (
    <s-page heading="Loyalty Analytics">

      {/* ── KPI cards ── */}
      <s-section heading="Last 30 days">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
          <KpiCard
            label="Total members"
            value={fmtNum(data.totalMembers)}
            sub={data.newMembers30d > 0 ? `+${data.newMembers30d} new this month` : "No new members this month"}
            icon={<IconUsers size={16} />}
            tint={{ bg: COLOR.accentBg, fg: COLOR.accent }}
          />
          <KpiCard
            label="Points issued"
            value={fmtNum(data.pointsIssued30d)}
            sub="This period"
            icon={<IconArrowUp size={14} />}
            tint={{ bg: COLOR.successBg, fg: COLOR.success }}
          />
          <KpiCard
            label="Points redeemed"
            value={fmtNum(data.pointsRedeemed30d)}
            sub="This period"
            icon={<IconArrowDown size={14} />}
            tint={{ bg: COLOR.criticalBg, fg: COLOR.critical }}
          />
          <KpiCard
            label="Outstanding balance"
            value={fmtNum(data.outstandingBalance)}
            sub="Across all members"
            icon={<IconWallet size={16} />}
            tint={{ bg: "#F1EBFB", fg: "#5C3EBF" }}
          />
        </div>
      </s-section>

      {/* ── Chart ── */}
      <s-section heading="Daily activity">
        <div style={{ ...cardShell, padding: "16px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
            <div style={{ display: "flex", gap: "16px" }}>
              {[[COLOR.success, "Issued"], [COLOR.critical, "Redeemed"]].map(([c, label]) => (
                <span key={label} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12.5px", color: COLOR.textSecondary, fontWeight: 500 }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: c as string, display: "inline-block" }} />
                  {label}
                </span>
              ))}
            </div>
            <span style={{ fontSize: "11.5px", color: COLOR.textTertiary }}>Last 30 days</span>
          </div>

          {hasChartActivity ? (
            <div style={{ position: "relative", width: "100%", height: "160px" }}>
              <canvas id="loyaltyChart" role="img" aria-label="Daily points chart" />
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "140px", gap: "8px" }}>
              <IconChart size={26} color={COLOR.textTertiary} />
              <div style={{ fontSize: "13px", fontWeight: 600, color: COLOR.text }}>No activity in the last 30 days</div>
              <div style={{ fontSize: "12px", color: COLOR.textTertiary }}>Points earned and redeemed will show up here.</div>
            </div>
          )}
        </div>
        {hasChartActivity && (
          <script dangerouslySetInnerHTML={{ __html: `(function(){var days=${JSON.stringify(chartDays)},issued=${JSON.stringify(chartIssued)},redeemed=${JSON.stringify(chartRedeemed)};function init(){if(typeof Chart==='undefined'){setTimeout(init,100);return;}var ctx=document.getElementById('loyaltyChart');if(!ctx)return;new Chart(ctx,{type:'bar',data:{labels:days,datasets:[{label:'Issued',data:issued,backgroundColor:'${COLOR.success}',borderRadius:3,maxBarThickness:14},{label:'Redeemed',data:redeemed,backgroundColor:'${COLOR.critical}',borderRadius:3,maxBarThickness:14}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{backgroundColor:'#1A1C1D',padding:10,cornerRadius:6,titleFont:{size:12},bodyFont:{size:12}}},scales:{x:{grid:{display:false},ticks:{autoSkip:true,maxTicksLimit:8,font:{size:11}}},y:{beginAtZero:true,ticks:{precision:0,font:{size:11}},grid:{color:'#F1F2F4'}}}}});}var s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';s.onload=init;document.head.appendChild(s);})();` }} />
        )}
      </s-section>

      {/* ── Top customers + recent transactions ── */}
      <s-section heading="Activity breakdown">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <div style={{ ...cardShell, padding: "14px 4px" }}>
            <div style={{ padding: "0 16px 10px", fontSize: "13px", fontWeight: 600, color: COLOR.text, borderBottom: `1px solid ${COLOR.borderSubtle}`, marginBottom: "4px" }}>Top customers</div>
            {data.topCustomers.length === 0 ? (
              <EmptyState title="No customers yet" subtitle="Your highest point earners will be ranked here." />
            ) : (
              <div>
                {data.topCustomers.map((c, i) => (
                  <div key={c.shopifyCustomerId} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "9px 16px" }}>
                    <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: COLOR.surfaceSubtle, border: `1px solid ${COLOR.borderSubtle}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 600, color: COLOR.textSecondary, flexShrink: 0 }}>
                      {i + 1}
                    </div>
                    <s-avatar initials={initials(c.name, c.shopifyCustomerId)} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "13.5px", color: COLOR.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name ?? `Customer ${c.shopifyCustomerId}`}</div>
                      <div style={{ fontSize: "12px", color: COLOR.textTertiary }}>{fmtNum(c.totalPoints)} pts</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ ...cardShell, padding: "14px 4px" }}>
            <div style={{ padding: "0 16px 10px", fontSize: "13px", fontWeight: 600, color: COLOR.text, borderBottom: `1px solid ${COLOR.borderSubtle}`, marginBottom: "4px" }}>Recent transactions</div>
            {data.recentTransactions.length === 0 ? (
              <EmptyState title="No transactions yet" subtitle="Points earned or redeemed across your store show up here." />
            ) : (
              <div>
                {data.recentTransactions.map((t) => {
                  const isPos = t.type === "earn" || t.type === "adjust";
                  return (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "9px 16px" }}>
                      <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: isPos ? COLOR.successBg : COLOR.criticalBg, color: isPos ? COLOR.success : COLOR.critical, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <IconReceipt size={13} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "13.5px", color: COLOR.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.note ?? (isPos ? "Award" : "Deduction")}</div>
                        <div style={{ fontSize: "12px", color: COLOR.textTertiary }}>{t.customerName ?? t.customerId} · {relativeTime(t.createdAt)}</div>
                      </div>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: isPos ? COLOR.success : COLOR.critical, flexShrink: 0 }}>
                        {isPos ? "+" : "−"}{fmtNum(t.points)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </s-section>

      {/* ── Tier distribution ── */}
      <s-section heading="Membership tier distribution">
        <div style={{ ...cardShell, padding: "16px 18px", display: "flex", flexDirection: "column", gap: "16px" }}>
          {data.tierStats.map(({ tier, count, threshold }) => {
            const pct = Math.round((count / totalForTier) * 100);
            const s = TIER_STYLES[tier.toLowerCase()] ?? TIER_STYLES.bronze;
            return (
              <div key={tier}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <IconMedal size={13} color={s.text} />
                    <span style={{ fontSize: "13.5px", fontWeight: 600, color: COLOR.text }}>{tier}</span>
                    <span style={{ color: COLOR.textTertiary, fontSize: "12.5px" }}>{threshold}</span>
                  </div>
                  <span style={{ fontSize: "12.5px", color: COLOR.textSecondary }}>{fmtNum(count)} members · {pct}%</span>
                </div>
                <div style={{ height: "6px", background: COLOR.surfaceSubtle, borderRadius: "4px", overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: s.bar, borderRadius: "4px", transition: "width 0.6s ease" }} />
                </div>
              </div>
            );
          })}
        </div>
      </s-section>

      {/* ── Members list ── */}
      <s-section heading="All members">
        <div style={{ ...cardShell, padding: "16px" }}>
          <div style={{ display: "flex", gap: "10px", marginBottom: "14px", alignItems: "center" }}>
            <div style={{ position: "relative", flex: 1 }}>
              <span style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: COLOR.textTertiary, display: "flex" }}>
                <IconSearch size={15} />
              </span>
              <input
                type="text"
                placeholder="Search by name, email, or customer ID…"
                value={searchQ}
                onChange={(e) => { setSearchQ(e.target.value); setPage(0); }}
                style={{ ...inp, width: "100%", boxSizing: "border-box", paddingLeft: "32px" }}
              />
            </div>
            <span style={{ fontSize: "12.5px", color: COLOR.textTertiary, alignSelf: "center", whiteSpace: "nowrap" }}>
              {filtered.length} member{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div style={{
            display: "grid", gridTemplateColumns: "1fr 150px 110px 110px 100px", gap: "8px",
            padding: "8px 12px", background: COLOR.surfaceSubtle, borderRadius: "6px", marginBottom: "2px",
            fontSize: "11px", fontWeight: 600, color: COLOR.textTertiary, textTransform: "uppercase", letterSpacing: "0.04em"
          }}>
            <div>Customer</div>
            <div style={{ textAlign: "center" }}>Tier</div>
            <div style={{ textAlign: "right" }}>Available</div>
            <div style={{ textAlign: "right" }}>Lifetime</div>
            <div style={{ textAlign: "center" }}>Actions</div>
          </div>

          {pageCustomers.length === 0 ? (
            <EmptyState
              title={searchQ ? `No matches for "${searchQ}"` : "No members yet"}
              subtitle={searchQ ? "Try a different name, email, or customer ID." : "Customers who join your loyalty program will appear here."}
            />
          ) : pageCustomers.map((c) => {
            const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || "No name";
            return (
              <div key={c.id} style={{
                display: "grid", gridTemplateColumns: "1fr 150px 110px 110px 100px",
                gap: "8px", padding: "9px 12px", alignItems: "center",
                borderTop: `1px solid ${COLOR.borderSubtle}`,
                background: selectedCustomer?.id === c.id ? COLOR.accentBg : "transparent",
              }}>
                <div>
                  <div style={{ fontWeight: 500, fontSize: "13.5px", color: COLOR.text }}>{name}</div>
                  <div style={{ fontSize: "12px", color: COLOR.textTertiary }}>{c.email ?? "No email"}</div>
                </div>
                <div style={{ textAlign: "center" }}><TierBadge tier={c.tier} /></div>
                <div style={{ textAlign: "right", fontWeight: 600, fontSize: "13.5px", color: COLOR.text }}>{fmtNum(c.points)}</div>
                <div style={{ textAlign: "right", fontSize: "12.5px", color: COLOR.textSecondary }}>{fmtNum(c.lifetimePoints)}</div>
                <div style={{ display: "flex", gap: "4px", justifyContent: "center" }}>
                  <button
                    onClick={() => openDetail(c)}
                    title="Adjust points"
                    aria-label="Adjust points"
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      width: "28px", height: "28px", borderRadius: "6px",
                      border: `1px solid ${COLOR.border}`, background: COLOR.surface, color: COLOR.textSecondary, cursor: "pointer"
                    }}>
                    <IconEdit size={13} />
                  </button>
                  <button
                    onClick={() => openDetail(c)}
                    title="View details"
                    aria-label="View details"
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      width: "28px", height: "28px", borderRadius: "6px",
                      border: `1px solid ${COLOR.border}`, background: COLOR.surface, color: COLOR.textSecondary, cursor: "pointer"
                    }}>
                    <IconEye size={13} />
                  </button>
                </div>
              </div>
            );
          })}

          {totalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "12px", paddingTop: "14px", marginTop: "4px", borderTop: `1px solid ${COLOR.borderSubtle}` }}>
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                style={{ display: "flex", alignItems: "center", gap: "4px", padding: "6px 12px", borderRadius: "6px", border: `1px solid ${COLOR.border}`, background: COLOR.surface, cursor: page === 0 ? "not-allowed" : "pointer", color: page === 0 ? COLOR.textTertiary : COLOR.text, fontSize: "12.5px", fontWeight: 500 }}>
                <IconChevronLeft size={12} /> Prev
              </button>
              <span style={{ fontSize: "12.5px", color: COLOR.textSecondary }}>Page {page + 1} of {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                style={{ display: "flex", alignItems: "center", gap: "4px", padding: "6px 12px", borderRadius: "6px", border: `1px solid ${COLOR.border}`, background: COLOR.surface, cursor: page >= totalPages - 1 ? "not-allowed" : "pointer", color: page >= totalPages - 1 ? COLOR.textTertiary : COLOR.text, fontSize: "12.5px", fontWeight: 500 }}>
                Next <IconChevronRight size={12} />
              </button>
            </div>
          )}
        </div>
      </s-section>

      {detailCustomer && (
        <CustomerModal
          customer={detailCustomer}
          onClose={() => { setDetailCustomer(null); setSelectedCustomer(null); }}
          fetcher={fetcher}
        />
      )}

    </s-page>
  );
}