import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useFetcher, Link } from "react-router";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

declare global {
  namespace JSX { interface IntrinsicElements { [elemName: string]: any; } }
}

// ── Defaults (must mirror LoyaltySettings @default values in schema.prisma) ──

const EARNING_DEFAULTS: Record<string, number | string> = {
  pointsPerCurrency: 10,
  orderAmountType: "subtotal",
  bronzeMultiplier: 1.0,
  silverMultiplier: 1.25,
  goldMultiplier: 1.5,
};

const REDEMPTION_DEFAULTS: Record<string, number | string> = {
  bronzeRedemptionRate: 100,
  silverRedemptionRate: 80,
  goldRedemptionRate: 60,
  voucherPreset1: 500,
  voucherPreset2: 1000,
  voucherPreset3: 2000,
};

function StatIcon({ name }: { name: "members" | "status" | "store" }) {
  const common = {
    width: 20, height: 20, viewBox: "0 0 24 24",
    fill: "none", stroke: "currentColor", strokeWidth: 1.75,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  };
  if (name === "members") {
    return (
      <svg {...common}>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  }
  if (name === "status") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}

function differsFromDefaults(settings: any, defaults: Record<string, number | string>) {
  if (!settings) return false;
  return Object.entries(defaults).some(([key, def]) => (settings as any)[key] !== def);
}

// Best-effort live storefront check — no read_themes scope required.
// Fetches the public homepage HTML and looks for our widget script tags.
// Returns null (not a boolean) for a flag when we genuinely can't tell
// (password-protected dev store, network error, timeout) so the UI can
// fall back to a manual checkbox instead of showing a false negative.
async function detectStorefrontFeatures(storeDomain: string): Promise<{
  embedDetected: boolean | null;
  ctaDetected: boolean | null;
}> {
  if (!storeDomain) return { embedDetected: null, ctaDetected: null };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`https://${storeDomain}/`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return { embedDetected: null, ctaDetected: null };
    const html = await res.text();
    return {
      embedDetected: html.includes("loyalty-widget.js"),
      ctaDetected: html.includes("loyalty-cta.js") || html.includes("loyalty-register"),
    };
  } catch {
    return { embedDetected: null, ctaDetected: null };
  }
}

// ── Loader ────────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const shopRes  = await admin.graphql(`query { shop { name myshopifyDomain currencyCode } }`);
  const shopData = await shopRes.json();
  const shopInfo = shopData.data?.shop ?? {};

  const [memberCount, settings, pageRes, storefrontCheck] = await Promise.all([
    db.loyaltyCustomer.count({ where: { shop } }),
    db.loyaltySettings.findUnique({ where: { shop } }),
    admin.graphql(`query { pages(first: 5, query: "title:'Loyalty Rewards'") { nodes { id title handle } } }`),
    detectStorefrontFeatures(shopInfo.myshopifyDomain),
  ]);

  const loyaltyPage = (await pageRes.json()).data?.pages?.nodes?.[0] ?? null;

  // Load saved manual checks — graceful fallback if column missing (pre-migration)
  let manualChecks: Record<string, boolean> = {};
  try {
    manualChecks = (settings as any)?.manualChecks
      ? JSON.parse((settings as any).manualChecks)
      : {};
  } catch { manualChecks = {}; }

  return {
    shop: shopInfo,
    memberCount,
    hasSettings: !!settings,
    loyaltyPage,
    manualChecks,
    earningConfigured: differsFromDefaults(settings, EARNING_DEFAULTS),
    redemptionConfigured: differsFromDefaults(settings, REDEMPTION_DEFAULTS),
    embedDetected: storefrontCheck.embedDetected,
    ctaDetected: storefrontCheck.ctaDetected,
  };
};

// ── Action — save manual check toggles (fallback only, when auto-detection is unavailable) ──

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const { key, value } = await request.json();

  const existing = await db.loyaltySettings.findUnique({ where: { shop } });
  const current  = existing ? (JSON.parse((existing as any).manualChecks ?? "{}")) : {};
  current[key]   = value;

  try {
    await db.loyaltySettings.upsert({
      where:  { shop },
      create: { shop, manualChecks: JSON.stringify(current) } as any,
      update: { manualChecks: JSON.stringify(current) } as any,
    });
  } catch (e) {
    console.error("[homepage] manualChecks save failed — run migration:", e);
  }

  return { ok: true };
};

// ── Icons (line icons, replace all emoji) ─────────────────────────────────────

type IconProps = { size?: number; color?: string };

const IconChartBar = ({ size = 16, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v12.5c0 .55.45 1 1 1h13" />
    <path d="M6 13.5V9.5M10 13.5V6M14 13.5v-5" />
  </svg>
);

const IconSettings = ({ size = 16, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="10" cy="10" r="2.6" />
    <path d="M10 2.7v2M10 15.3v2M17.3 10h-2M4.7 10h-2M15.1 4.9l-1.4 1.4M6.3 13.7l-1.4 1.4M15.1 15.1l-1.4-1.4M6.3 6.3 4.9 4.9" />
  </svg>
);

const IconCart = ({ size = 16, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 3h2l1.6 9.3a1.5 1.5 0 0 0 1.5 1.2h6.4a1.5 1.5 0 0 0 1.5-1.2l1.1-6.3H5.4" />
    <circle cx="8" cy="17" r="1.1" />
    <circle cx="14.5" cy="17" r="1.1" />
  </svg>
);

const IconBox = ({ size = 16, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.7 6.2 10 2.5l7.3 3.7v7.6L10 17.5l-7.3-3.7z" />
    <path d="M2.7 6.2 10 9.9l7.3-3.7M10 9.9v7.6" />
  </svg>
);

const IconGift = ({ size = 16, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="8" width="14" height="9" rx="1" />
    <path d="M3 11.5h14M10 8v9" />
    <path d="M10 8c-1.2 0-3-.6-3-2.4C7 4.5 7.9 3.5 9 3.5c1.4 0 1.9 2 1 4.5" />
    <path d="M10 8c1.2 0 3-.6 3-2.4 0-1.1-.9-2.1-2-2.1-1.4 0-1.9 2-1 4.5" />
  </svg>
);

const IconTrophy = ({ size = 16, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 3.5h8v4.2a4 4 0 0 1-8 0z" />
    <path d="M6 4.3H3.7v1.5A2.7 2.7 0 0 0 6 8.4M14 4.3h2.3v1.5A2.7 2.7 0 0 1 14 8.4" />
    <path d="M10 11.7v2.6M7.3 16.5h5.4M8.2 14.3h3.6l.6 2.2H7.6z" />
  </svg>
);

const IconLink = ({ size = 16, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8.2 11.8 11.8 8.2" />
    <path d="M9 6.3 10.4 5A3.2 3.2 0 1 1 15 9.6l-1.3 1.3" />
    <path d="M11 13.7 9.6 15A3.2 3.2 0 1 1 5 10.4l1.3-1.3" />
  </svg>
);

const IconPuzzle = ({ size = 22, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 4h4v2a1.6 1.6 0 0 0 3.2 0V4H20v4h-2a1.6 1.6 0 0 0 0 3.2h2V15h-3.8a1.6 1.6 0 0 0 0 3.2V20H12v-2a1.6 1.6 0 0 0-3.2 0v2H4v-4h2a1.6 1.6 0 0 0 0-3.2H4V9h3.8A1.6 1.6 0 0 0 9 6.4z" />
  </svg>
);

const IconMegaphone = ({ size = 22, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 10v4a1 1 0 0 0 1 1h1l1.4 4.5a1 1 0 0 0 1 .7h1a1 1 0 0 0 1-1.2L7.6 15" />
    <path d="M4 10h3l9-4.5a1 1 0 0 1 1.4.9v11.2a1 1 0 0 1-1.4.9L7 14H4z" />
    <path d="M17.4 9a3.6 3.6 0 0 1 0 6" />
  </svg>
);

const IconCircleDot = ({ size = 22, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="2.6" fill={color} stroke="none" />
  </svg>
);

const IconDocument = ({ size = 22, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
    <path d="M14 3v4h4M8.5 13h7M8.5 16.5h7" />
  </svg>
);

const IconExternal = ({ size = 12, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6.5 4.5h5v5" />
    <path d="M11.3 4.7 4.7 11.3" />
  </svg>
);

const IconArrowRight = ({ size = 12, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 8h10M9 4.3 12.7 8 9 11.7" />
  </svg>
);

const IconCheck = ({ size = 12, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3.3 8.4 6.5 11.5 12.7 4.8" />
  </svg>
);

const IconSparkles = ({ size = 15, color = "currentColor" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 2.2c.3 1.9 1 2.6 2.9 2.9-1.9.3-2.6 1-2.9 2.9-.3-1.9-1-2.6-2.9-2.9 1.9-.3 2.6-1 2.9-2.9Z" fill={color} stroke="none" />
    <path d="M13 8.6c.2 1.1.6 1.5 1.7 1.7-1.1.2-1.5.6-1.7 1.7-.2-1.1-.6-1.5-1.7-1.7 1.1-.2 1.5-.6 1.7-1.7Z" fill={color} stroke="none" />
    <path d="M3.8 10.4c.15.85.45 1.15 1.3 1.3-.85.15-1.15.45-1.3 1.3-.15-.85-.45-1.15-1.3-1.3.85-.15 1.15-.45 1.3-1.3Z" fill={color} stroke="none" />
  </svg>
);

// ── Design tokens (shared with analytics page) ────────────────────────────────

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

const primaryBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: "6px",
  padding: "7px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
  background: COLOR.text, color: "#fff", textDecoration: "none", border: "1px solid " + COLOR.text,
};

const secondaryBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: "6px",
  padding: "7px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
  background: COLOR.surfaceSubtle, color: COLOR.text, textDecoration: "none",
  border: `1px solid ${COLOR.border}`,
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function Index() {
  const {
    shop, memberCount, hasSettings, loyaltyPage, manualChecks,
    earningConfigured, redemptionConfigured, embedDetected, ctaDetected,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const storeDomain = (shop as any).myshopifyDomain ?? "";
  const adminBase   = `https://admin.shopify.com/store/${storeDomain.replace(".myshopify.com", "")}`;

  // Manual fallback state — only ever read/used when live detection returns null
  // (e.g. password-protected dev store, storefront fetch failed).
  const [checks, setChecks] = useState<Record<string, boolean>>({
    embed_enabled: !!manualChecks?.embed_enabled,
    cta_added:     !!manualChecks?.cta_added,
  });

  const toggle = (key: string) => {
    const next = { ...checks, [key]: !checks[key] };
    setChecks(next);
    fetcher.submit(
      { key, value: next[key] },
      { method: "POST", encType: "application/json" },
    );
  };

  const embedAuto = embedDetected !== null;
  const ctaAuto   = ctaDetected !== null;

  const checklist = [
    {
      key:    "auto_install",
      auto:   true,
      done:   memberCount > 0 || hasSettings,
      title:  "App installed & configured",
      desc:   "Your loyalty program is active and ready to accept members.",
      action: null,
    },
    {
      key:    "auto_page",
      auto:   true,
      done:   !!loyaltyPage,
      title:  "Loyalty Rewards page created",
      desc:   loyaltyPage
        ? `Page is live at /pages/${loyaltyPage.handle}`
        : "Not found. Re-install the app to auto-create it.",
      action: loyaltyPage
        ? { label: "View page", url: `https://${storeDomain}/pages/${loyaltyPage.handle}`, external: true }
        : null,
    },
    {
      key:    "embed_enabled",
      auto:   embedAuto,
      done:   embedDetected ?? checks.embed_enabled,
      title:  "Enable App Embed in theme",
      desc:   embedAuto
        ? "Detected automatically from your live storefront."
        : "We couldn't verify this automatically (dev store password, or the fetch failed) — open the theme editor, go to App Embeds, and toggle on Loyalty Widget.",
      action: { label: "Open App Embeds", url: `${adminBase}/themes/current/editor?context=apps`, external: true },
    },
    {
      key:    "cta_added",
      auto:   ctaAuto,
      done:   ctaDetected ?? checks.cta_added,
      title:  "Add loyalty widget to your storefront",
      desc:   ctaAuto
        ? "Detected automatically — a loyalty section or CTA block is live on your storefront."
        : "Use the theme editor to add the Loyalty Register section or CTA block to your homepage or product pages.",
      action: { label: "Open theme editor", url: `${adminBase}/themes/current/editor`, external: true },
    },
    {
      key:    "earning_configured",
      auto:   true,
      done:   earningConfigured,
      title:  "Configure earning rules",
      desc:   "Set points per currency, order amount type, and tier multipliers in Settings.",
      action: { label: "Go to Settings", url: "/app/settings", external: false },
    },
    {
      key:    "redemption_configured",
      auto:   true,
      done:   redemptionConfigured,
      title:  "Set redemption rates & voucher presets",
      desc:   "Configure how many points equal a discount and the 3 voucher amounts in Settings → Redemption.",
      action: { label: "Go to Settings", url: "/app/settings", external: false },
    },
  ];

  const doneCount = checklist.filter((c) => c.done).length;
  const allDone   = doneCount === checklist.length;
  const pct       = Math.round((doneCount / checklist.length) * 100);

  const quickLinks = [
    { label: "Analytics", url: "/app/analytics", icon: <IconChartBar size={15} /> },
    { label: "Settings",  url: "/app/settings",  icon: <IconSettings size={15} /> },
  ];

  const howItWorks = [
    { icon: <IconCart size={15} />,     step: "Order placed",     desc: "Points awarded as pending" },
    { icon: <IconBox size={15} />,      step: "Order fulfilled",  desc: "Points become spendable" },
    { icon: <IconGift size={15} />,     step: "Customer redeems", desc: "Discount code generated" },
    { icon: <IconTrophy size={15} />,   step: "Tier upgrade",     desc: "Based on lifetime points" },
    { icon: <IconLink size={15} />,     step: "Referral bonus",   desc: "Both parties earn extra pts" },
  ];

  const widgetGuide = [
    {
      icon: <IconPuzzle size={20} color={COLOR.accent} />, title: "Loyalty Widget",
      desc: "Full dashboard — balance, tier, redeem, history, referral code. Add as an App Embed.",
      tag: "App Embeds → Loyalty Widget",
    },
    {
      icon: <IconMegaphone size={20} color={COLOR.accent} />, title: "Loyalty Register Section",
      desc: "Rich-text style section with heading, description, and join/dashboard button.",
      tag: "Add section → Apps → Loyalty Register",
    },
    {
      icon: <IconCircleDot size={20} color={COLOR.accent} />, title: "Loyalty CTA Block",
      desc: "Compact join button. Place on homepage, product pages, or cart.",
      tag: "Add block → Apps → Loyalty CTA",
    },
    {
      icon: <IconDocument size={20} color={COLOR.accent} />, title: "Loyalty Rewards Page",
      desc: "Auto-created on install. Enable the App Embed and the widget renders automatically.",
      tag: loyaltyPage ? `Live at /pages/${loyaltyPage.handle}` : "Not found — reinstall app",
      tagOk: !!loyaltyPage,
    },
  ];

  return (
    <s-page heading={`Welcome to Loyalify${(shop as any).name ? `, ${(shop as any).name}` : ""}`}>

      {/* ── Stats ── */}
      <s-section>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
          {[
            { icon: "members" as const, label: "Loyalty members",  value: memberCount.toLocaleString(), sub: "enrolled customers" },
            { icon: "status" as const,  label: "Program status",   value: hasSettings ? "Active" : "Not configured", sub: hasSettings ? "earning rules set" : "complete setup below", warn: !hasSettings },
            { icon: "store" as const,   label: "Store",             value: (shop as any).name ?? storeDomain, sub: (shop as any).currencyCode ?? "" },
          ].map(({ icon, label, value, sub, warn }) => (
            <div key={label} style={{ ...cardShell, padding: "16px 18px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
                <div style={{
                  width: "38px", height: "38px", borderRadius: "9px", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: warn ? COLOR.criticalBg : COLOR.accentBg,
                  color: warn ? COLOR.critical : COLOR.accent,
                }}>
                  <StatIcon name={icon} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "12px", color: COLOR.textSecondary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: "4px" }}>{label}</div>
                  <div style={{ fontSize: "19px", fontWeight: 700, color: warn ? COLOR.critical : COLOR.text, marginBottom: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
                  <div style={{ fontSize: "12px", color: COLOR.textTertiary }}>{sub}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </s-section>

      {/* ── Checklist ── */}
      <s-section heading="Setup checklist">
        <div style={{ ...cardShell, padding: "18px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: COLOR.textSecondary }}>
              {allDone && <IconSparkles size={14} color={COLOR.success} />}
              {allDone ? "All steps complete" : `${doneCount} of ${checklist.length} steps completed`}
            </div>
            <div style={{ fontSize: "13px", fontWeight: 700, color: COLOR.text }}>{pct}%</div>
          </div>
          <div style={{ height: "6px", background: COLOR.surfaceSubtle, borderRadius: "999px", overflow: "hidden", marginBottom: "20px" }}>
            <div style={{ height: "100%", borderRadius: "999px", background: allDone ? COLOR.success : COLOR.text, width: `${pct}%`, transition: "width 0.5s ease" }} />
          </div>

          {checklist.map(({ key, auto, done, title, desc, action }, i) => (
            <div key={key} style={{
              display: "flex", gap: "14px", alignItems: "flex-start",
              padding: "14px 0",
              borderTop: i === 0 ? "none" : `1px solid ${COLOR.borderSubtle}`,
            }}>
              {/* Checkbox — auto/detected ones show tick, manual fallback ones are clickable */}
              {auto ? (
                <div style={{
                  width: "22px", height: "22px", borderRadius: "50%", flexShrink: 0, marginTop: "2px",
                  background: done ? COLOR.text : COLOR.surfaceSubtle,
                  border: `2px solid ${done ? COLOR.text : COLOR.border}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "12px", color: "#fff",
                }}>
                  {done ? <IconCheck size={11} color="#fff" /> : <span style={{ color: COLOR.textTertiary, fontSize: "10px", fontWeight: 700 }}>{i + 1}</span>}
                </div>
              ) : (
                <button
                  onClick={() => toggle(key)}
                  title={done ? "Mark as not done" : "Mark as done"}
                  style={{
                    width: "22px", height: "22px", borderRadius: "5px", flexShrink: 0, marginTop: "2px",
                    background: done ? COLOR.text : "#fff",
                    border: `2px solid ${done ? COLOR.text : "#d1d5db"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", color: "#fff",
                    transition: "all 0.15s",
                  }}
                >
                  {done && <IconCheck size={11} color="#fff" />}
                </button>
              )}

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3px", flexWrap: "wrap" }}>
                  <div style={{
                    fontWeight: 600, fontSize: "14px",
                    color: done ? COLOR.textTertiary : COLOR.text,
                    textDecoration: done ? "line-through" : "none",
                  }}>
                    {title}
                  </div>
                  {done && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", background: COLOR.successBg, color: "#00512F", fontSize: "11px", fontWeight: 600, padding: "1px 8px", borderRadius: "999px", border: "1px solid #B7E3CD" }}>
                      <IconCheck size={9} color="#00512F" /> Done
                    </span>
                  )}
                  {!auto && !done && (
                    <span style={{ fontSize: "11px", color: COLOR.textTertiary }}>click checkbox when done</span>
                  )}
                </div>
                <div style={{ fontSize: "13px", color: COLOR.textSecondary, lineHeight: 1.5 }}>{desc}</div>
                {action && !done && (
                  <div style={{ marginTop: "8px" }}>
                    {action.external ? (
                      <a href={action.url} target="_blank" rel="noreferrer" style={primaryBtn}>
                        {action.label} <IconExternal size={11} color="#fff" />
                      </a>
                    ) : (
                      <Link to={action.url} style={secondaryBtn}>
                        {action.label} <IconArrowRight size={11} />
                      </Link>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </s-section>

      {/* ── Quick links aside ── */}
      <s-section slot="aside" heading="Quick links">
        {quickLinks.map(({ label, url, icon }) => (
          <div key={url} style={{ marginBottom: "8px" }}>
            <Link to={url} style={{
              display: "flex", alignItems: "center", gap: "10px",
              padding: "10px 14px", borderRadius: "8px",
              background: COLOR.surfaceSubtle, border: `1px solid ${COLOR.borderSubtle}`,
              fontSize: "13.5px", fontWeight: 500, color: COLOR.text,
              textDecoration: "none",
            }}>
              <span style={{ color: COLOR.textSecondary, display: "flex" }}>{icon}</span>
              {label}
            </Link>
          </div>
        ))}
      </s-section>

      {/* ── How it works aside ── */}
      <s-section slot="aside" heading="How it works">
        {howItWorks.map(({ icon, step, desc }, i) => (
          <div key={step} style={{ display: "flex", gap: "10px", marginBottom: i === howItWorks.length - 1 ? 0 : "12px", alignItems: "flex-start" }}>
            <div style={{
              width: "26px", height: "26px", borderRadius: "7px", flexShrink: 0,
              background: COLOR.accentBg, color: COLOR.accent,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {icon}
            </div>
            <div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: COLOR.text }}>{step}</div>
              <div style={{ fontSize: "12px", color: COLOR.textTertiary }}>{desc}</div>
            </div>
          </div>
        ))}
      </s-section>

      {/* ── Widget guide ── */}
      <s-section heading="Adding the widget to your storefront">
        <div style={{ ...cardShell, padding: "18px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            {widgetGuide.map(({ icon, title, desc, tag, tagOk }) => (
              <div key={title} style={{ background: COLOR.surfaceSubtle, border: `1px solid ${COLOR.borderSubtle}`, borderRadius: "10px", padding: "16px" }}>
                <div style={{
                  width: "36px", height: "36px", borderRadius: "9px", marginBottom: "10px",
                  background: COLOR.accentBg, display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {icon}
                </div>
                <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "4px", color: COLOR.text }}>{title}</div>
                <div style={{ fontSize: "13px", color: COLOR.textSecondary, marginBottom: "10px", lineHeight: 1.5 }}>{desc}</div>
                <div style={{
                  fontSize: "11px", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "5px",
                  color: tagOk ? "#00512F" : COLOR.text,
                  background: tagOk ? COLOR.successBg : "#fff",
                  padding: "4px 9px", borderRadius: "5px",
                  border: `1px solid ${tagOk ? "#B7E3CD" : COLOR.border}`,
                }}>
                  {tagOk && <IconCheck size={10} color="#00512F" />}
                  {tag}
                </div>
              </div>
            ))}
          </div>
        </div>
      </s-section>

    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};