import { useLoaderData, useFetcher } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { getLoyaltySettings, saveLoyaltySettings } from "../services/loyaltySettings.server";
import { getTierConfig, saveTierConfig } from "../services/tierService";

declare global {
  namespace JSX { interface IntrinsicElements { [elemName: string]: any; } }
}

// ── Shared design tokens ─────────────────────────────────────────────────
const RADIUS_CONTAINER = 12; // outer cards / panels
const RADIUS_CONTROL   = 8;  // inputs, small badges
const RADIUS_PILL      = 999;

const COLOR_TEXT       = "#1A1A1A";
const COLOR_SECONDARY  = "#6B7280";
const COLOR_TERTIARY   = "#9CA3AF";
const COLOR_BORDER     = "#E5E7EB";
const COLOR_SUBSURFACE = "#FAFAFA";

// ─────────────────────────────────────────────────────────────────────────
// NOTE: loader / action below are unchanged from the original implementation.
// No validation rules, field names, or persisted values have been altered —
// only the presentation layer (this file's JSX/CSS) has been redesigned.
// ─────────────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  const [settings, tierConfig, shopRes] = await Promise.all([
    getLoyaltySettings(session.shop),
    getTierConfig(session.shop),
    admin.graphql(`query { shop { currencyCode } }`),
  ]);

  const shopData = await shopRes.json();
  const currency = shopData.data?.shop?.currencyCode ?? "USD";

  return { settings, tierConfig, currency };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const contentType = request.headers.get("content-type") ?? "";
  let raw: Record<string, any>;
  if (contentType.includes("application/json")) { raw = await request.json(); }
  else { const fd = await request.formData(); raw = Object.fromEntries(fd.entries()); }

  const tab     = raw.tab as string;
  const current = await getLoyaltySettings(session.shop);

  if (tab === "tiers") {
    const silver = Number(raw.silver);
    const gold   = Number(raw.gold);
    const errors: string[] = [];
    if (silver <= 0)        errors.push("Silver threshold must be greater than Bronze (0).");
    if (gold   <= silver)   errors.push("Gold threshold must be greater than Silver.");
    if (silver > 1_000_000) errors.push("Silver threshold seems unreasonably high.");
    if (gold   > 1_000_000) errors.push("Gold threshold seems unreasonably high.");
    if (errors.length) return { ok: false, errors, tab: "tiers" };

    await saveTierConfig(session.shop, { bronze: 0, silver, gold });
    return { ok: true, errors: [], tab: "tiers" };
  }

  if (tab === "style") {
    await saveLoyaltySettings(session.shop, {
      ...current,
      accentColor:     String(raw.accentColor     ?? current.accentColor),
      bgColor:         String(raw.bgColor         ?? current.bgColor),
      textColor:       String(raw.textColor       ?? current.textColor),
      buttonColor:     String(raw.buttonColor     ?? current.buttonColor),
      buttonTextColor: String(raw.buttonTextColor ?? current.buttonTextColor),
      borderRadius:    Number(raw.borderRadius    ?? current.borderRadius),
    });
    return { ok: true, errors: [], tab: "style" };
  }

  if (tab === "referral") {
    const signupBonus = Number(raw.referralSignupBonus);
    const referrerPct = Number(raw.referralReferrerPct);
    const refereePct  = Number(raw.referralRefereePct);
    const errors: string[] = [];
    if (signupBonus < 0)  errors.push("Signup bonus cannot be negative.");
    if (referrerPct < 0 || referrerPct > 100) errors.push("Referrer % must be 0–100.");
    if (refereePct  < 0 || refereePct  > 100) errors.push("Referee % must be 0–100.");
    if (errors.length) return { ok: false, errors, tab: "referral" };
    await saveLoyaltySettings(session.shop, { ...current, referralSignupBonus: signupBonus, referralReferrerPct: referrerPct, referralRefereePct: refereePct });
    return { ok: true, errors: [], tab: "referral" };
  }

  if (tab === "redemption") {
    const bronzeRate = Number(raw.bronzeRedemptionRate);
    const silverRate = Number(raw.silverRedemptionRate);
    const goldRate   = Number(raw.goldRedemptionRate);
    const p1         = Number(raw.voucherPreset1);
    const p2         = Number(raw.voucherPreset2);
    const p3         = Number(raw.voucherPreset3);

    const errors: string[] = [];
    if (bronzeRate <= 0) errors.push("Bronze redemption rate must be positive.");
    if (silverRate <= 0) errors.push("Silver redemption rate must be positive.");
    if (goldRate   <= 0) errors.push("Gold redemption rate must be positive.");
    if (p1 <= 0 || p2 <= 0 || p3 <= 0) errors.push("Voucher presets must be positive.");
    if (p1 >= p2 || p2 >= p3) errors.push("Voucher presets must be in ascending order.");
    if (errors.length) return { ok: false, errors, tab: "redemption" };

    await saveLoyaltySettings(session.shop, {
      ...current,
      bronzeRedemptionRate: bronzeRate,
      silverRedemptionRate: silverRate,
      goldRedemptionRate:   goldRate,
      voucherPreset1: p1, voucherPreset2: p2, voucherPreset3: p3,
    });
    return { ok: true, errors: [], tab: "redemption" };
  }

  const pointsPerCurrency = Number(raw.pointsPerCurrency);
  const orderAmountType   = raw.orderAmountType as "subtotal" | "total";
  const bronzeMultiplier  = Number(raw.bronzeMultiplier);
  const silverMultiplier  = Number(raw.silverMultiplier);
  const goldMultiplier    = Number(raw.goldMultiplier);

  const errors: string[] = [];
  if (isNaN(pointsPerCurrency) || pointsPerCurrency <= 0) errors.push("Points per currency must be positive.");
  if (!["subtotal","total"].includes(orderAmountType))     errors.push("Order amount type must be subtotal or total.");
  if (bronzeMultiplier <= 0)                               errors.push("Bronze multiplier must be positive.");
  if (silverMultiplier <= bronzeMultiplier)                errors.push("Silver multiplier must be greater than Bronze.");
  if (goldMultiplier   <= silverMultiplier)                errors.push("Gold multiplier must be greater than Silver.");
  if (errors.length) return { ok: false, errors, tab: "earning" };

  await saveLoyaltySettings(session.shop, { ...current, pointsPerCurrency, orderAmountType, bronzeMultiplier, silverMultiplier, goldMultiplier });
  return { ok: true, errors: [], tab: "earning" };
};

// ── Icons (replace emoji, all inherit color via currentColor / prop) ────────

function MedalIcon({ color, size = 22 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path d="M7.5 3L4.5 9.5M16.5 3l3 6.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="14" r="7" stroke={color} strokeWidth="1.6" />
      <path d="M12 10.6l.9 1.85 2.05.3-1.48 1.44.35 2.04L12 15.23l-1.82 1 .35-2.04-1.48-1.44 2.05-.3.9-1.85z" fill={color} />
    </svg>
  );
}

function CartIcon({ color = COLOR_TEXT, size = 20 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3 4h2l2.2 11.2A2 2 0 0 0 9.15 17H18a2 2 0 0 0 1.95-1.57L21.5 8H6" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9.5" cy="20.5" r="1.4" fill={color} />
      <circle cx="17.5" cy="20.5" r="1.4" fill={color} />
    </svg>
  );
}

function PackageIcon({ color = COLOR_TEXT, size = 20 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 3l8 4.2v9.6L12 21l-8-4.2V7.2L12 3z" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M4.3 7.4L12 11.5l7.7-4.1M12 11.5V21" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function CancelIcon({ color = COLOR_TEXT, size = 20 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8.2" stroke={color} strokeWidth="1.6" />
      <path d="M9.3 9.3l5.4 5.4M14.7 9.3l-5.4 5.4" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function TicketIcon({ color = COLOR_TEXT, size = 20 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3 9.5a2 2 0 0 0 0 5V17a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-2.5a2 2 0 0 1 0-5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v2.5z" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M14.5 6v12" stroke={color} strokeWidth="1.6" strokeDasharray="2.2 2.2" />
    </svg>
  );
}

function ChevronIcon({ color = COLOR_TERTIARY, size = 16 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M9 5l7 7-7 7" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SectionIcon({ path, color = COLOR_TEXT, size = 18 }: { path: string; color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d={path} stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ICON_PATHS = {
  tiers:      "M4 20V10M12 20V4M20 20v-7",
  earning:    "M12 2v20M17 6.5c0-1.9-2.2-3.5-5-3.5S7 4.6 7 6.5 9.2 10 12 10s5 1.6 5 3.5-2.2 3.5-5 3.5-5-1.6-5-3.5",
  redemption: "M20.5 12.5a3 3 0 0 0 0-1L21 9l-2-1-1-2-2.5.5a3 3 0 0 0-1 0L12 5l-2.5 1.5a3 3 0 0 0-1 0L6 6l-1 2-2 1 .5 2.5a3 3 0 0 0 0 1L3 15l2 1 1 2 2.5-.5a3 3 0 0 0 1 0L12 19l2.5-1.5a3 3 0 0 0 1 0L18 18l1-2 2-1-.5-2.5z M9 12l2 2 4-4",
  referral:   "M17 11a4 4 0 1 0-4-4 M9 15a4 4 0 1 0-4 4 M5 19c0-2.5 2-4 4-4s4 1.5 4 4 M13 11c0 2.5 2 4 4 4s4-1.5 4 4",
  style:      "M12 3a9 9 0 1 0 9 9c0-1-1-1.5-2-1.5h-2a2 2 0 0 1-2-2v-1a2 2 0 0 1 2-2h1c.8 0 1.3-.9.8-1.6A9 9 0 0 0 12 3z M7.5 12a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M9.5 8.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M14 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
};

// ── Small reusable presentational pieces ────────────────────────────────────

function CardHeader({ iconPath, tint, title, caption }: { iconPath: string; tint: string; title: string; caption: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", marginBottom: "20px" }}>
      <div style={{
        width: "34px", height: "34px", borderRadius: RADIUS_CONTROL, flexShrink: 0,
        background: `${tint}14`, display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <SectionIcon path={iconPath} color={tint} />
      </div>
      <div>
        <div style={{ fontWeight: 650, fontSize: "16px", color: COLOR_TEXT, letterSpacing: "-0.01em" }}>{title}</div>
        <div style={{ fontSize: "12.5px", color: COLOR_SECONDARY, marginTop: "2px" }}>{caption}</div>
      </div>
    </div>
  );
}

function NumField({
  label, value, onChange, suffix, min, max, step = 1, prefixIcon,
}: {
  label: string; value: number; onChange: (v: number) => void; suffix?: string;
  min?: number; max?: number; step?: number; prefixIcon?: React.ReactNode;
}) {
  return (
    <div>
      <div style={{ fontSize: "12.5px", fontWeight: 600, color: COLOR_SECONDARY, marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
        {prefixIcon}{label}
      </div>
      <div style={{ display: "flex", alignItems: "center", border: `1px solid ${COLOR_BORDER}`, borderRadius: RADIUS_CONTROL, background: "#fff", overflow: "hidden" }}>
        <input
          type="number" value={value} min={min} max={max} step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ flex: 1, minWidth: 0, width: "100%", padding: "9px 12px", border: "none", outline: "none", fontSize: "14px", color: COLOR_TEXT, background: "transparent" }}
        />
        {suffix && (
          <span style={{ padding: "9px 12px", fontSize: "12.5px", color: COLOR_TERTIARY, borderLeft: `1px solid ${COLOR_BORDER}`, whiteSpace: "nowrap" }}>
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function ColorSwatch({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", border: `1px solid ${COLOR_BORDER}`, borderRadius: RADIUS_CONTROL, background: "#fff" }}>
      <div style={{ position: "relative", width: "30px", height: "30px", flexShrink: 0 }}>
        <div style={{ width: "100%", height: "100%", borderRadius: "7px", background: value, border: "1px solid rgba(0,0,0,0.08)" }} />
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
          style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: "12px", color: COLOR_SECONDARY, marginBottom: "2px" }}>{label}</div>
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
          style={{ width: "100%", border: "none", outline: "none", fontFamily: "monospace", fontSize: "13px", color: COLOR_TEXT, padding: 0, background: "transparent" }} />
      </div>
    </div>
  );
}

// Format a number as store currency
function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

const TIER_META = {
  bronze: { label: "Bronze", color: "#D85A30", bg: "#FFF4F0" },
  silver: { label: "Silver", color: "#5F5E5A", bg: "#F5F5F4" },
  gold:   { label: "Gold",   color: "#BA7517", bg: "#FFFBF0" },
} as const;

export default function SettingsPage() {
  const { settings, tierConfig, currency } = useLoaderData<typeof loader>();
  const fetcher  = useFetcher<typeof action>();
  const isSaving = fetcher.state !== "idle";
  const result   = fetcher.data;

  // Tier thresholds — controlled, so the ladder preview updates live as you type
  const [tierSilver, setTierSilver] = useState(tierConfig.silver ?? 1000);
  const [tierGold,   setTierGold]   = useState(tierConfig.gold   ?? 5000);

  // Earning — controlled, so the formula preview updates live as you type
  const [ppc, setPpc]                     = useState(settings.pointsPerCurrency ?? 10);
  const [orderAmountType, setOrderAmountType] = useState<"subtotal" | "total">(settings.orderAmountType ?? "subtotal");
  const [bronzeMult, setBronzeMult] = useState(settings.bronzeMultiplier ?? 1);
  const [silverMult, setSilverMult] = useState(settings.silverMultiplier ?? 1.25);
  const [goldMult,   setGoldMult]   = useState(settings.goldMultiplier   ?? 1.5);

  // Redemption — drives the preview table
  const [bronzeRate, setBronzeRate] = useState(settings.bronzeRedemptionRate ?? 100);
  const [silverRate, setSilverRate] = useState(settings.silverRedemptionRate ?? 80);
  const [goldRate,   setGoldRate]   = useState(settings.goldRedemptionRate   ?? 60);
  const [p1, setP1] = useState(settings.voucherPreset1 ?? 500);
  const [p2, setP2] = useState(settings.voucherPreset2 ?? 1000);
  const [p3, setP3] = useState(settings.voucherPreset3 ?? 2000);

  // Referral
  const [signupBonus, setSignupBonus] = useState(settings.referralSignupBonus ?? 100);
  const [referrerPct, setReferrerPct] = useState(settings.referralReferrerPct ?? 10);
  const [refereePct,  setRefereePct]  = useState(settings.referralRefereePct  ?? 10);

  // Widget style
  const [accentColor,     setAccentColor]     = useState(settings.accentColor     ?? "#d4a017");
  const [bgColor,         setBgColor]         = useState(settings.bgColor         ?? "#0d0d0d");
  const [textColor,       setTextColor]       = useState(settings.textColor       ?? "#ffffff");
  const [buttonColor,     setButtonColor]     = useState(settings.buttonColor     ?? "#d4a017");
  const [buttonTextColor, setButtonTextColor] = useState(settings.buttonTextColor ?? "#0d0d0d");
  const [borderRadius,    setBorderRadius]    = useState(settings.borderRadius    ?? 16);

  // Lifecycle — purely presentational interactivity, no persisted state
  const [openStep, setOpenStep] = useState<number>(0);

  const handleSaveTiers = () => fetcher.submit({
    tab: "tiers", silver: tierSilver, gold: tierGold,
  }, { method: "POST", encType: "application/json" });

  const handleSaveEarning = () => fetcher.submit({
    tab: "earning",
    pointsPerCurrency: ppc,
    orderAmountType,
    bronzeMultiplier: bronzeMult,
    silverMultiplier: silverMult,
    goldMultiplier: goldMult,
  }, { method: "POST", encType: "application/json" });

  const handleSaveRedemption = () => fetcher.submit({
    tab: "redemption",
    bronzeRedemptionRate: bronzeRate, silverRedemptionRate: silverRate, goldRedemptionRate: goldRate,
    voucherPreset1: p1, voucherPreset2: p2, voucherPreset3: p3,
  }, { method: "POST", encType: "application/json" });

  const handleSaveReferral = () => fetcher.submit({
    tab: "referral",
    referralSignupBonus: signupBonus, referralReferrerPct: referrerPct, referralRefereePct: refereePct,
  }, { method: "POST", encType: "application/json" });

  const handleSaveStyle = () => fetcher.submit(
    { tab: "style", accentColor, bgColor, textColor, buttonColor, buttonTextColor, borderRadius },
    { method: "POST", encType: "application/json" },
  );

  // Section wrapper: title/error banners scoped to whichever section just saved
  function SaveBanner({ tab }: { tab: string }) {
    const ok  = result?.ok === true  && result?.tab === tab;
    const bad = result?.ok === false && result?.tab === tab && (result?.errors?.length ?? 0) > 0;
    if (!ok && !bad) return null;
    return ok ? (
      <div style={{ background: "#EAF3DE", border: "1px solid #97C459", borderRadius: RADIUS_CONTROL, padding: "10px 14px", marginBottom: "16px", color: "#3B6D11", fontSize: "13px", fontWeight: 500 }}>
        Settings saved
      </div>
    ) : (
      <div style={{ background: "#FCEBEB", border: "1px solid #F09595", borderRadius: RADIUS_CONTROL, padding: "10px 14px", marginBottom: "16px", color: "#A32D2D", fontSize: "13px" }}>
        {result!.errors!.map((e: string) => <div key={e}>{e}</div>)}
      </div>
    );
  }

  const cardStyle: React.CSSProperties = {
    background: "#fff", border: `1px solid ${COLOR_BORDER}`, borderRadius: RADIUS_CONTAINER, padding: "24px",
  };

  const exampleOrder = 50;
  const examplePoints = Math.floor(exampleOrder * ppc * goldMult);

  const lifecycleSteps = [
    { icon: CartIcon,    label: "Order paid",     tint: "#B45309", state: "Pending",  desc: "Points are awarded as Pending — visible to the customer but not yet spendable." },
    { icon: PackageIcon, label: "Order fulfilled", tint: "#15803D", state: "Active",   desc: "Pending points convert to Active — the customer can now redeem them." },
    { icon: TicketIcon,  label: "Points redeemed", tint: "#7C3AED", state: "Redeemed", desc: `Customer exchanges points for a one-time ${currency} discount code, valid 30 days.` },
  ];

  return (
    <s-page heading="Loyalty Settings">

      {/* ── MEMBERSHIP TIERS ── */}
      <s-section>
        <div style={cardStyle}>
          <CardHeader iconPath={ICON_PATHS.tiers} tint="#374151" title="Membership tiers"
            caption="Based on lifetime points earned — tiers never drop when a customer redeems." />
          <SaveBanner tab="tiers" />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "14px", marginBottom: "22px" }}>
            {(["bronze", "silver", "gold"] as const).map((t) => {
              const meta = TIER_META[t];
              const from = t === "bronze" ? 0 : t === "silver" ? tierSilver : tierGold;
              const to   = t === "bronze" ? tierSilver - 1 : t === "silver" ? tierGold - 1 : null;
              return (
                <div key={t} style={{ background: meta.bg, border: `1px solid ${meta.color}2b`, borderRadius: RADIUS_CONTAINER, padding: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                    <MedalIcon color={meta.color} />
                    <span style={{ fontWeight: 700, fontSize: "14px", color: meta.color }}>{meta.label}</span>
                  </div>
                  <div style={{
                    display: "inline-flex", fontSize: "11px", fontWeight: 600, color: meta.color,
                    background: "#fff", border: `1px solid ${meta.color}2b`, borderRadius: RADIUS_PILL, padding: "3px 9px",
                  }}>
                    {to !== null ? `${from.toLocaleString()}–${to.toLocaleString()} pts` : `${from.toLocaleString()}+ pts`}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", alignItems: "end" }}>
            <div>
              <div style={{ fontSize: "12.5px", fontWeight: 600, color: COLOR_SECONDARY, marginBottom: "6px" }}>Bronze starts at</div>
              <div style={{ padding: "9px 12px", borderRadius: RADIUS_CONTROL, background: COLOR_SUBSURFACE, border: `1px solid ${COLOR_BORDER}`, fontSize: "14px", color: COLOR_TERTIARY }}>0 pts (fixed)</div>
            </div>
            <NumField label="Silver starts at" value={tierSilver} min={1} max={999999} suffix="pts"
              onChange={(v) => setTierSilver(v || 1)} />
            <NumField label="Gold starts at" value={tierGold} min={2} max={1000000} suffix="pts"
              onChange={(v) => setTierGold(v || 2)} />
          </div>

          <div style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end" }}>
            <s-button variant="primary" onClick={handleSaveTiers} {...(isSaving ? { loading: true } : {})}>
              {isSaving ? "Saving…" : "Save"}
            </s-button>
          </div>
        </div>
      </s-section>

      {/* ── EARNING RULES ── */}
      <s-section>
        <div style={cardStyle}>
          <CardHeader iconPath={ICON_PATHS.earning} tint="#374151" title="Earning rules"
            caption="How points accrue per order, before tier multipliers are applied." />
          <SaveBanner tab="earning" />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "18px" }}>
            <NumField label={`Points earned per 1 ${currency}`} value={ppc} min={0.1} step={0.1} suffix="pts"
              onChange={setPpc} />
            <div>
              <div style={{ fontSize: "12.5px", fontWeight: 600, color: COLOR_SECONDARY, marginBottom: "6px" }}>Base order amount on</div>
              <select value={orderAmountType} onChange={(e) => setOrderAmountType(e.target.value as "subtotal" | "total")}
                style={{ width: "100%", padding: "9px 12px", border: `1px solid ${COLOR_BORDER}`, borderRadius: RADIUS_CONTROL, fontSize: "14px", background: "#fff", cursor: "pointer", color: COLOR_TEXT }}>
                <option value="subtotal">Subtotal (products only)</option>
                <option value="total">Total (incl. shipping &amp; tax)</option>
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "20px" }}>
            <NumField label="Bronze multiplier" value={bronzeMult} min={0.1} step={0.05} suffix="×"
              prefixIcon={<MedalIcon color={TIER_META.bronze.color} size={15} />} onChange={setBronzeMult} />
            <NumField label="Silver multiplier" value={silverMult} min={0.1} step={0.05} suffix="×"
              prefixIcon={<MedalIcon color={TIER_META.silver.color} size={15} />} onChange={setSilverMult} />
            <NumField label="Gold multiplier" value={goldMult} min={0.1} step={0.05} suffix="×"
              prefixIcon={<MedalIcon color={TIER_META.gold.color} size={15} />} onChange={setGoldMult} />
          </div>

          <div style={{
            background: "#111827", borderRadius: RADIUS_CONTAINER, padding: "18px 20px",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap",
          }}>
            <div>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px" }}>Formula</div>
              <code style={{ fontSize: "13.5px", color: "#E5E7EB" }}>orderAmount × pointsPerCurrency × tierMultiplier</code>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "11px", color: "#9CA3AF", marginBottom: "4px" }}>
                {formatCurrency(exampleOrder, currency)} order · Gold {goldMult}×
              </div>
              <div style={{ fontSize: "22px", fontWeight: 700, color: "#FBBF24" }}>{examplePoints.toLocaleString()} pts</div>
            </div>
          </div>

          <div style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end" }}>
            <s-button variant="primary" onClick={handleSaveEarning} {...(isSaving ? { loading: true } : {})}>
              {isSaving ? "Saving…" : "Save"}
            </s-button>
          </div>
        </div>
      </s-section>

      {/* ── REDEMPTION ── */}
      <s-section>
        <div style={cardStyle}>
          <CardHeader iconPath={ICON_PATHS.redemption} tint="#374151" title="Redemption"
            caption="How points convert into discounts, per tier." />
          <SaveBanner tab="redemption" />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "22px" }}>
            <NumField label="Bronze rate" value={bronzeRate} min={1} suffix={`pts = 1 ${currency}`}
              prefixIcon={<MedalIcon color={TIER_META.bronze.color} size={15} />} onChange={(v) => setBronzeRate(v || 1)} />
            <NumField label="Silver rate" value={silverRate} min={1} suffix={`pts = 1 ${currency}`}
              prefixIcon={<MedalIcon color={TIER_META.silver.color} size={15} />} onChange={(v) => setSilverRate(v || 1)} />
            <NumField label="Gold rate" value={goldRate} min={1} suffix={`pts = 1 ${currency}`}
              prefixIcon={<MedalIcon color={TIER_META.gold.color} size={15} />} onChange={(v) => setGoldRate(v || 1)} />
          </div>

          <div style={{ fontSize: "12.5px", fontWeight: 600, color: COLOR_SECONDARY, marginBottom: "10px" }}>
            Voucher presets — the amounts customers can choose from at checkout
          </div>
          <div style={{ border: `1px solid ${COLOR_BORDER}`, borderRadius: RADIUS_CONTAINER, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13.5px" }}>
              <thead>
                <tr style={{ background: COLOR_SUBSURFACE }}>
                  <th style={{ textAlign: "left",  padding: "10px 16px", fontWeight: 600, color: COLOR_SECONDARY, fontSize: "12px" }}>Preset</th>
                  <th style={{ textAlign: "left",  padding: "10px 16px", fontWeight: 600, color: COLOR_SECONDARY, fontSize: "12px" }}>Points</th>
                  <th style={{ textAlign: "right", padding: "10px 16px", fontWeight: 600, color: TIER_META.bronze.color, fontSize: "12px" }}>Bronze value</th>
                  <th style={{ textAlign: "right", padding: "10px 16px", fontWeight: 600, color: TIER_META.silver.color, fontSize: "12px" }}>Silver value</th>
                  <th style={{ textAlign: "right", padding: "10px 16px", fontWeight: 600, color: TIER_META.gold.color, fontSize: "12px" }}>Gold value</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: "Small",  val: p1, set: setP1 },
                  { label: "Medium", val: p2, set: setP2 },
                  { label: "Large",  val: p3, set: setP3 },
                ].map(({ label, val, set }, i) => (
                  <tr key={label} style={{ borderTop: i === 0 ? "none" : `1px solid ${COLOR_BORDER}` }}>
                    <td style={{ padding: "10px 16px", color: COLOR_SECONDARY }}>{label}</td>
                    <td style={{ padding: "8px 16px" }}>
                      <input type="number" value={val} min={1} step={50} onChange={(e) => set(Number(e.target.value) || 1)}
                        style={{ width: "100px", padding: "7px 10px", border: `1px solid ${COLOR_BORDER}`, borderRadius: RADIUS_CONTROL, fontSize: "13.5px" }} />
                    </td>
                    <td style={{ textAlign: "right", padding: "10px 16px" }}>{formatCurrency(val / bronzeRate, currency)}</td>
                    <td style={{ textAlign: "right", padding: "10px 16px" }}>{formatCurrency(val / silverRate, currency)}</td>
                    <td style={{ textAlign: "right", padding: "10px 16px", fontWeight: 600, color: TIER_META.gold.color }}>{formatCurrency(val / goldRate, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end" }}>
            <s-button variant="primary" onClick={handleSaveRedemption} {...(isSaving ? { loading: true } : {})}>
              {isSaving ? "Saving…" : "Save"}
            </s-button>
          </div>
        </div>
      </s-section>

      {/* ── REFERRAL ── */}
      <s-section>
        <div style={cardStyle}>
          <CardHeader iconPath={ICON_PATHS.referral} tint="#374151" title="Referral program"
            caption="Reward both sides when a customer refers a friend." />
          <SaveBanner tab="referral" />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "18px" }}>
            <NumField label="Signup bonus" value={signupBonus} min={0} step={10} suffix="pts"
              onChange={setSignupBonus} />
            <NumField label="Referrer gets" value={referrerPct} min={0} max={100} suffix="% of order"
              onChange={setReferrerPct} />
            <NumField label="Referee gets" value={refereePct} min={0} max={100} suffix="% bonus"
              onChange={setRefereePct} />
          </div>

          <div style={{ fontSize: "12.5px", color: COLOR_SECONDARY, background: COLOR_SUBSURFACE, borderRadius: RADIUS_CONTROL, padding: "10px 14px" }}>
            New member gets <strong style={{ color: COLOR_TEXT }}>{signupBonus} pts</strong> on signup. On a {formatCurrency(50, currency)} first order
            (500 base pts): referrer earns <strong style={{ color: COLOR_TEXT }}>{Math.floor(500 * referrerPct / 100)} pts</strong>,
            referee earns <strong style={{ color: COLOR_TEXT }}>{Math.floor(500 * refereePct / 100)} pts</strong> extra.
          </div>

          <div style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end" }}>
            <s-button variant="primary" onClick={handleSaveReferral} {...(isSaving ? { loading: true } : {})}>
              {isSaving ? "Saving…" : "Save"}
            </s-button>
          </div>
        </div>
      </s-section>

      {/* ── WIDGET STYLE ── */}
      <s-section>
        <div style={cardStyle}>
          <CardHeader iconPath={ICON_PATHS.style} tint="#374151" title="Widget style"
            caption="Appearance of the loyalty widget shown to customers." />
          <SaveBanner tab="style" />

          <div style={{ display: "flex", gap: "28px", alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ flex: "1.3", minWidth: "300px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
                <ColorSwatch label="Accent"          value={accentColor}     onChange={setAccentColor} />
                <ColorSwatch label="Background"      value={bgColor}         onChange={setBgColor} />
                <ColorSwatch label="Text"            value={textColor}       onChange={setTextColor} />
                <ColorSwatch label="Button"          value={buttonColor}     onChange={setButtonColor} />
                <ColorSwatch label="Button text"     value={buttonTextColor} onChange={setButtonTextColor} />
              </div>
              <div>
                <div style={{ fontSize: "12.5px", fontWeight: 600, color: COLOR_SECONDARY, marginBottom: "8px" }}>Corner radius</div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <input type="range" min={0} max={32} value={borderRadius} onChange={(e) => setBorderRadius(Number(e.target.value))} style={{ flex: 1, cursor: "pointer" }} />
                  <span style={{ fontSize: "13px", color: COLOR_SECONDARY, minWidth: "40px", textAlign: "right" }}>{borderRadius}px</span>
                </div>
              </div>
              <div style={{ marginTop: "20px" }}>
                <s-button variant="primary" onClick={handleSaveStyle} {...(isSaving ? { loading: true } : {})}>
                  {isSaving ? "Saving…" : "Save"}
                </s-button>
              </div>
            </div>

            <div style={{ flex: "1", minWidth: "240px" }}>
              <div style={{ fontSize: "11px", fontWeight: 600, color: COLOR_TERTIARY, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px" }}>Live preview</div>
              <div style={{ background: bgColor, borderRadius: `${borderRadius}px`, padding: "26px 22px", fontFamily: "'DM Sans', sans-serif", boxShadow: "0 4px 24px rgba(0,0,0,0.12)" }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: "5px", background: `${accentColor}22`, border: `1px solid ${accentColor}66`, borderRadius: RADIUS_PILL, padding: "3px 10px", fontSize: "10px", fontWeight: 600, color: accentColor, textTransform: "uppercase", marginBottom: "14px" }}>Loyalty</div>
                <div style={{ color: textColor, fontSize: "34px", fontWeight: 700, lineHeight: 1, marginBottom: "4px" }}>1,250</div>
                <div style={{ color: `${textColor}88`, fontSize: "13px", marginBottom: "16px" }}>points available</div>
                <div style={{ height: "6px", background: `${textColor}18`, borderRadius: RADIUS_PILL, overflow: "hidden", marginBottom: "16px" }}>
                  <div style={{ width: "62%", height: "100%", background: accentColor, borderRadius: RADIUS_PILL }} />
                </div>
                <div style={{ background: buttonColor, color: buttonTextColor, borderRadius: `${Math.max(4, borderRadius - 4)}px`, padding: "11px 20px", fontSize: "14px", fontWeight: 600, textAlign: "center" }}>Redeem points</div>
              </div>
            </div>
          </div>
        </div>
      </s-section>

      {/* ── POINTS LIFECYCLE (interactive) ── */}
      <s-section heading="Points lifecycle">
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "stretch", marginBottom: "4px" }}>
            {lifecycleSteps.map((step, i) => {
              const isOpen = openStep === i;
              const Icon = step.icon;
              return (
                <div key={step.label} style={{ display: "flex", alignItems: "stretch", flex: 1 }}>
                  <div style={{ flex: 1 }}>
                    <button
                      onClick={() => setOpenStep(isOpen ? -1 : i)}
                      style={{
                        width: "100%", textAlign: "left", background: isOpen ? `${step.tint}0d` : "transparent",
                        border: `1px solid ${isOpen ? step.tint + "40" : COLOR_BORDER}`, borderRadius: RADIUS_CONTAINER,
                        padding: "16px", cursor: "pointer", transition: "background 0.15s, border-color 0.15s",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                        <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: `${step.tint}18`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Icon color={step.tint} size={17} />
                        </div>
                        <div style={{
                          fontSize: "10.5px", fontWeight: 700, color: step.tint, textTransform: "uppercase",
                          letterSpacing: "0.05em", background: `${step.tint}14`, borderRadius: RADIUS_PILL, padding: "2px 8px",
                        }}>
                          {step.state}
                        </div>
                      </div>
                      <div style={{ fontWeight: 600, fontSize: "14px", color: COLOR_TEXT, marginBottom: isOpen ? "8px" : 0 }}>
                        {step.label}
                      </div>
                      {isOpen && (
                        <div style={{ fontSize: "12.5px", color: COLOR_SECONDARY, lineHeight: 1.5 }}>{step.desc}</div>
                      )}
                    </button>
                  </div>
                  {i < lifecycleSteps.length - 1 && (
                    <div style={{ display: "flex", alignItems: "center", padding: "0 6px", color: COLOR_TERTIARY }}>
                      <ChevronIcon />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: "14px", display: "flex", alignItems: "center", gap: "10px", padding: "12px 16px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: RADIUS_CONTROL }}>
            <CancelIcon color="#DC2626" size={17} />
            <div style={{ fontSize: "12.5px", color: "#991B1B" }}>
              <strong>Order cancelled at any stage:</strong> Pending points are voided; Active points already granted are deducted.
            </div>
          </div>
        </div>
      </s-section>
    </s-page>
  );
}