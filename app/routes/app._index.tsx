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
    width: 22, height: 22, viewBox: "0 0 24 24",
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
            <s-card key={label}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
                <div style={{
                  width: "40px", height: "40px", borderRadius: "10px", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: warn ? "#fef2f2" : "#f3f4f6",
                  color: warn ? "#b91c1c" : "#0d0d0d",
                }}>
                  <StatIcon name={icon} />
                </div>
                <div>
                  <div style={{ fontSize: "11px", color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "4px" }}>{label}</div>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: warn ? "#b91c1c" : "#0d0d0d", marginBottom: "2px" }}>{value}</div>
                  <div style={{ fontSize: "12px", color: "#aaa" }}>{sub}</div>
                </div>
              </div>
            </s-card>
          ))}
        </div>
      </s-section>

      {/* ── Checklist ── */}
      <s-section heading="Setup checklist">
        <s-card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
            <div style={{ fontSize: "13px", color: "#666" }}>
              {allDone ? "🎉 All steps complete!" : `${doneCount} of ${checklist.length} steps completed`}
            </div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#0d0d0d" }}>{pct}%</div>
          </div>
          <div style={{ height: "6px", background: "#f0f0f0", borderRadius: "999px", overflow: "hidden", marginBottom: "24px" }}>
            <div style={{ height: "100%", borderRadius: "999px", background: "#0d0d0d", width: `${pct}%`, transition: "width 0.5s ease" }} />
          </div>

          {checklist.map(({ key, auto, done, title, desc, action }, i) => (
            <div key={key} style={{
              display: "flex", gap: "14px", alignItems: "flex-start",
              padding: "14px 0",
              borderTop: i === 0 ? "none" : "1px solid #f5f5f5",
            }}>
              {/* Checkbox — auto/detected ones show tick, manual fallback ones are clickable */}
              {auto ? (
                <div style={{
                  width: "22px", height: "22px", borderRadius: "50%", flexShrink: 0, marginTop: "2px",
                  background: done ? "#0d0d0d" : "#f3f4f6",
                  border: `2px solid ${done ? "#0d0d0d" : "#e5e7eb"}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "12px", color: "#fff",
                }}>
                  {done ? "✓" : <span style={{ color: "#9ca3af", fontSize: "10px", fontWeight: 700 }}>{i + 1}</span>}
                </div>
              ) : (
                <button
                  onClick={() => toggle(key)}
                  title={done ? "Mark as not done" : "Mark as done"}
                  style={{
                    width: "22px", height: "22px", borderRadius: "5px", flexShrink: 0, marginTop: "2px",
                    background: done ? "#0d0d0d" : "#fff",
                    border: `2px solid ${done ? "#0d0d0d" : "#d1d5db"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", fontSize: "12px", color: "#fff",
                    transition: "all 0.15s",
                  }}
                >
                  {done ? "✓" : ""}
                </button>
              )}

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3px", flexWrap: "wrap" }}>
                  <div style={{
                    fontWeight: 600, fontSize: "14px",
                    color: done ? "#9ca3af" : "#0d0d0d",
                    textDecoration: done ? "line-through" : "none",
                  }}>
                    {title}
                  </div>
                  {done && (
                    <span style={{ background: "#f0fdf4", color: "#166534", fontSize: "11px", fontWeight: 600, padding: "1px 7px", borderRadius: "999px", border: "1px solid #bbf7d0" }}>
                      Done
                    </span>
                  )}
                  {!auto && !done && (
                    <span style={{ fontSize: "11px", color: "#9ca3af" }}>click checkbox when done</span>
                  )}
                </div>
                <div style={{ fontSize: "13px", color: "#666", lineHeight: 1.5 }}>{desc}</div>
                {action && !done && (
                  <div style={{ marginTop: "8px" }}>
                    {action.external ? (
                      <a href={action.url} target="_blank" rel="noreferrer" style={{
                        display: "inline-flex", alignItems: "center", gap: "4px",
                        padding: "6px 14px", borderRadius: "6px", fontSize: "13px", fontWeight: 600,
                        background: "#0d0d0d", color: "#fff", textDecoration: "none",
                      }}>
                        {action.label} ↗
                      </a>
                    ) : (
                      <Link to={action.url} style={{
                        display: "inline-flex", alignItems: "center", gap: "4px",
                        padding: "6px 14px", borderRadius: "6px", fontSize: "13px", fontWeight: 600,
                        background: "#f3f4f6", color: "#0d0d0d", textDecoration: "none",
                        border: "1px solid #e5e7eb",
                      }}>
                        {action.label} →
                      </Link>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </s-card>
      </s-section>

      {/* ── Quick links aside ── */}
      <s-section slot="aside" heading="Quick links">
        {[
          { label: "📊 Analytics",  url: "/app/analytics" },
          { label: "⚙️ Settings",   url: "/app/settings"  },
        ].map(({ label, url }) => (
          <div key={url} style={{ marginBottom: "8px" }}>
            <Link to={url} style={{
              display: "block", padding: "10px 14px", borderRadius: "8px",
              background: "#fafafa", border: "1px solid #efefef",
              fontSize: "14px", fontWeight: 500, color: "#0d0d0d",
              textDecoration: "none",
            }}>
              {label}
            </Link>
          </div>
        ))}
      </s-section>

      {/* ── How it works aside ── */}
      <s-section slot="aside" heading="How it works">
        {[
          { icon: "🛒", step: "Order placed",      desc: "Points awarded as pending" },
          { icon: "📦", step: "Order fulfilled",   desc: "Points become spendable" },
          { icon: "🎁", step: "Customer redeems",  desc: "Discount code generated" },
          { icon: "🏆", step: "Tier upgrade",      desc: "Based on lifetime points" },
          { icon: "🔗", step: "Referral bonus",    desc: "Both parties earn extra pts" },
        ].map(({ icon, step, desc }) => (
          <div key={step} style={{ display: "flex", gap: "10px", marginBottom: "12px", alignItems: "flex-start" }}>
            <span style={{ fontSize: "16px", flexShrink: 0, marginTop: "1px" }}>{icon}</span>
            <div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#0d0d0d" }}>{step}</div>
              <div style={{ fontSize: "12px", color: "#888" }}>{desc}</div>
            </div>
          </div>
        ))}
      </s-section>

      {/* ── Widget guide ── */}
      <s-section heading="Adding the widget to your storefront">
        <s-card>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            {[
              {
                icon: "🧩", title: "Loyalty Widget",
                desc: "Full dashboard — balance, tier, redeem, history, referral code. Add as an App Embed.",
                tag: "App Embeds → Loyalty Widget",
              },
              {
                icon: "📣", title: "Loyalty Register Section",
                desc: "Rich-text style section with heading, description, and join/dashboard button.",
                tag: "Add section → Apps → Loyalty Register",
              },
              {
                icon: "🔘", title: "Loyalty CTA Block",
                desc: "Compact join button. Place on homepage, product pages, or cart.",
                tag: "Add block → Apps → Loyalty CTA",
              },
              {
                icon: "📄", title: "Loyalty Rewards Page",
                desc: "Auto-created on install. Enable the App Embed and the widget renders automatically.",
                tag: loyaltyPage ? `✓ Live at /pages/${loyaltyPage.handle}` : "Not found — reinstall app",
              },
            ].map(({ icon, title, desc, tag }) => (
              <div key={title} style={{ background: "#fafafa", border: "1px solid #efefef", borderRadius: "10px", padding: "16px" }}>
                <div style={{ fontSize: "24px", marginBottom: "8px" }}>{icon}</div>
                <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "4px" }}>{title}</div>
                <div style={{ fontSize: "13px", color: "#666", marginBottom: "8px", lineHeight: 1.5 }}>{desc}</div>
                <div style={{ fontSize: "11px", color: "#0d0d0d", fontWeight: 600, background: "#f3f4f6", padding: "4px 8px", borderRadius: "4px", display: "inline-block", border: "1px solid #e5e7eb" }}>
                  {tag}
                </div>
              </div>
            ))}
          </div>
        </s-card>
      </s-section>

    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};