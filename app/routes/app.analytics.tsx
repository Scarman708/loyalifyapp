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
  await authenticate.admin(request);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [allCustomersRaw, transactions30d, recentRaw] = await Promise.all([
    db.loyaltyCustomer.findMany({
      orderBy: { lifetimePoints: "desc" },
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
          orderBy: { createdAt: "desc" },
          select: {
            id: true, type: true, points: true, note: true,
            status: true, createdAt: true, orderName: true,
          },
        },
        vouchers: {
          select: {
            id: true, code: true, discountAmount: true,
            pointsUsed: true, status: true, expiresAt: true,
          },
        },
      },
    }),
    db.pointTransaction.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      select: { type: true, points: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    db.pointTransaction.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      select: {
        id: true, customerId: true, type: true, points: true, note: true, createdAt: true,
        customer: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  const totalMembers       = allCustomersRaw.length;
  const newMembers30d      = allCustomersRaw.filter((c) => c.createdAt >= thirtyDaysAgo).length;
  const outstandingBalance = allCustomersRaw.reduce((s, c) => s + c.points, 0);

  let pointsIssued30d = 0, pointsRedeemed30d = 0;
  for (const t of transactions30d) {
    if (t.type === "earn" || t.type === "adjust") pointsIssued30d   += t.points;
    else                                           pointsRedeemed30d += t.points;
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
    if (t.type === "earn" || t.type === "adjust") entry.issued   += t.points;
    else                                           entry.redeemed += t.points;
  }
  const dailyStats = Array.from(dayMap.entries()).map(([date, v]) => ({ date, ...v }));

  const tierCounts = { Gold: 0, Silver: 0, Bronze: 0 };
  for (const c of allCustomersRaw) {
    const t = c.lifetimePoints >= 2000 ? "Gold" : c.lifetimePoints >= 500 ? "Silver" : "Bronze";
    tierCounts[t]++;
  }
  const tierStats = [
    { tier: "Gold"   as TierName, count: tierCounts.Gold,   threshold: "≥ 2,000 pts" },
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
  const raw  = await request.json();
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
        data: { shop, customerId, type: "adjust", points: pts, status: "active",
          note: note || `Manual adjustment by merchant (+${pts} pts)` },
      }),
    ]);
    const updated = await db.loyaltyCustomer.findUnique({ where: { id: customerId } });
    if (updated) {
      try {
        const { syncPointsMetafield } = await import("../services/points.server");
        const { evaluateAndUpdateTier } = await import("../services/tierService");
        await syncPointsMetafield(admin, updated.shopifyCustomerId, updated.points);
        await evaluateAndUpdateTier({ id: updated.id, shopifyCustomerId: updated.shopifyCustomerId,
          shop: updated.shop, lifetimePoints: updated.lifetimePoints, tier: updated.tier }, admin);
      } catch (e) { console.error("[analytics/action] sync error:", e); }
    }
    return { ok: true, intent, pts, customerId };
  }

  if (intent === "deduct") {
    if (customer.points < pts) return { ok: false, error: `Customer only has ${customer.points} points` };
    await db.$transaction([
      db.loyaltyCustomer.update({ where: { id: customerId }, data: { points: { decrement: pts } } }),
      db.pointTransaction.create({
        data: { shop, customerId, type: "adjust", points: -pts, status: "active",
          note: note || `Manual deduction by merchant (−${pts} pts)` },
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

// ── Helpers ───────────────────────────────────────────────────────────────────

const TIER_STYLES: Record<string, { bg: string; text: string; border: string; bar: string }> = {
  bronze: { bg: "#fdf0e6", text: "#b85c1a", border: "#f0c090", bar: "#D85A30" },
  silver: { bg: "#f0f2f5", text: "#4a5568", border: "#c0c8d8", bar: "#5F5E5A" },
  gold:   { bg: "#fefae6", text: "#92630a", border: "#f0d060", bar: "#BA7517" },
};
const TIER_ICONS: Record<string, string> = { bronze: "🥉", silver: "🥈", gold: "🥇" };

function TierBadge({ tier }: { tier: string }) {
  const c = TIER_STYLES[tier] ?? TIER_STYLES.bronze;
  return (
    <span style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}`,
      borderRadius: "999px", padding: "2px 10px", fontSize: "12px", fontWeight: 600,
      textTransform: "capitalize", whiteSpace: "nowrap" }}>
      {TIER_ICONS[tier] ?? "🥉"} {tier}
    </span>
  );
}

function fmtNum(n: number) { return n.toLocaleString(); }

function relativeTime(date: any) {
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
  if (diff < 1)  return "just now";
  if (diff < 60) return `${diff}m ago`;
  const h = Math.floor(diff / 60);
  if (h < 24)    return `${h}h ago`;
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
  if (status === "pending")  return { label: "Pending",  bg: "#fef3c7", color: "#92400e" };
  if (status === "voided")   return { label: "Voided",   bg: "#fee2e2", color: "#991b1b" };
  if (status === "deducted") return { label: "Deducted", bg: "#fee2e2", color: "#991b1b" };
  if (type === "earn")       return { label: "Earned",   bg: "#d1fae5", color: "#065f46" };
  if (type === "redeem")     return { label: "Redeemed", bg: "#ede9fe", color: "#5b21b6" };
  if (type === "adjust")     return { label: "Adjusted", bg: "#e0f2fe", color: "#0369a1" };
  return { label: type, bg: "#f3f4f6", color: "#374151" };
}

const inp: React.CSSProperties = {
  padding: "8px 12px", border: "1px solid #ccc", borderRadius: "6px", fontSize: "14px",
};

// ── Customer Detail Modal ─────────────────────────────────────────────────────

function CustomerModal({
  customer, onClose, fetcher,
}: {
  customer: any;
  onClose: () => void;
  fetcher: any;
}) {
  const [tab,        setTab]        = useState<"overview" | "transactions" | "vouchers">("overview");
  const [adjustTab,  setAdjustTab]  = useState<"add" | "deduct">("add");
  const [adjustPts,  setAdjustPts]  = useState("");
  const [adjustNote, setAdjustNote] = useState("");

  const isSaving = fetcher.state !== "idle";
  const result   = fetcher.data as any;
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
      background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-start",
      justifyContent: "flex-end",
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{
        width: "520px", maxWidth: "100vw", height: "100vh", background: "#fff",
        overflowY: "auto", display: "flex", flexDirection: "column",
        boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
      }}>
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #efefef", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "4px" }}>
              {customer.firstName || customer.lastName
                ? `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim()
                : "No name"}
            </div>
            <div style={{ fontSize: "13px", color: "#666" }}>{customer.email ?? "No email"}</div>
            <div style={{ fontSize: "11px", color: "#aaa", marginTop: "2px" }}>ID: {customer.shopifyCustomerId}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <TierBadge tier={customer.tier} />
            <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", color: "#666", lineHeight: 1, padding: "4px" }}>✕</button>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: "flex", gap: "0", borderBottom: "1px solid #efefef" }}>
          {[
            { label: "Available", value: fmtNum(currentPts), accent: true },
            { label: "Lifetime",  value: fmtNum(customer.lifetimePoints) },
            { label: "Member since", value: formatDate(customer.createdAt) },
          ].map(({ label, value, accent }) => (
            <div key={label} style={{ flex: 1, padding: "14px 16px", borderRight: "1px solid #efefef" }}>
              <div style={{ fontSize: "11px", color: "#888", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>{label}</div>
              <div style={{ fontSize: "18px", fontWeight: 700, color: accent ? "#1d4ed8" : "#0d0d0d" }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #efefef" }}>
          {(["overview", "transactions", "vouchers"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: "10px 0", fontSize: "13px", fontWeight: tab === t ? 600 : 400,
              color: tab === t ? "#0d0d0d" : "#888", background: "none", border: "none",
              borderBottom: `2px solid ${tab === t ? "#0d0d0d" : "transparent"}`,
              marginBottom: "-1px", cursor: "pointer", textTransform: "capitalize",
            }}>{t}</button>
          ))}
        </div>

        <div style={{ padding: "20px 24px", flex: 1 }}>

          {/* ── Overview tab ── */}
          {tab === "overview" && (
            <div>
              <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "14px" }}>Adjust points</div>

              {myResult?.ok === true && (
                <div style={{ background: "#EAF3DE", border: "1px solid #97C459", borderRadius: "6px", padding: "10px 14px", marginBottom: "12px", fontSize: "13px", color: "#3B6D11" }}>
                  ✓ {myResult.intent === "add" ? `+${myResult.pts}` : `−${myResult.pts}`} points applied.
                </div>
              )}
              {myResult?.ok === false && (
                <div style={{ background: "#FCEBEB", border: "1px solid #F09595", borderRadius: "6px", padding: "10px 14px", marginBottom: "12px", fontSize: "13px", color: "#A32D2D" }}>
                  ⚠ {myResult.error}
                </div>
              )}

              <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
                {(["add", "deduct"] as const).map((t) => (
                  <button key={t} onClick={() => setAdjustTab(t)} style={{
                    padding: "7px 16px", borderRadius: "6px", fontSize: "13px", fontWeight: 600,
                    cursor: "pointer", border: "none",
                    background: adjustTab === t ? (t === "add" ? "#d1fae5" : "#fee2e2") : "#f3f4f6",
                    color: adjustTab === t ? (t === "add" ? "#065f46" : "#991b1b") : "#666",
                  }}>
                    {t === "add" ? "➕ Add" : "➖ Deduct"}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div>
                  <div style={{ fontSize: "12px", color: "#666", marginBottom: "4px" }}>Points</div>
                  <input type="number" min={1} value={adjustPts} onChange={(e) => setAdjustPts(e.target.value)}
                    placeholder="e.g. 100" style={{ ...inp, width: "140px" }} />
                </div>
                <div>
                  <div style={{ fontSize: "12px", color: "#666", marginBottom: "4px" }}>Note (optional)</div>
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
                <div style={{ color: "#aaa", fontSize: "13px", textAlign: "center", padding: "32px 0" }}>No transactions yet.</div>
              ) : (
                <div style={{ border: "1px solid #efefef", borderRadius: "8px", overflow: "hidden" }}>
                  {customer.transactions.map((tx: any, i: number) => {
                    const badge = txBadge(tx.type, tx.status);
                    return (
                      <div key={tx.id} style={{
                        display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px",
                        borderTop: i === 0 ? "none" : "1px solid #f5f5f5",
                        background: i % 2 === 0 ? "#fff" : "#fafafa",
                      }}>
                        <span style={{ background: badge.bg, color: badge.color, borderRadius: "999px",
                          padding: "2px 8px", fontSize: "11px", fontWeight: 600, flexShrink: 0 }}>
                          {badge.label}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "13px", color: "#333", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {tx.note ?? (tx.orderName ? `Order ${tx.orderName}` : tx.type)}
                          </div>
                          <div style={{ fontSize: "11px", color: "#aaa" }}>{formatDate(tx.createdAt)}</div>
                        </div>
                        <div style={{ fontSize: "13px", fontWeight: 700, flexShrink: 0, color: tx.points > 0 ? "#065f46" : "#991b1b" }}>
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
                <div style={{ color: "#aaa", fontSize: "13px", textAlign: "center", padding: "32px 0" }}>No active vouchers.</div>
              ) : (
                activeVouchers.map((v: any) => (
                  <div key={v.id} style={{ background: "#f9f9f9", border: "1px solid #efefef", borderRadius: "8px", padding: "14px 16px", marginBottom: "10px" }}>
                    <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: "16px", color: "#1d4ed8", marginBottom: "4px" }}>{v.code}</div>
                    <div style={{ fontSize: "13px", color: "#555" }}>{v.discountAmount} off · {v.pointsUsed} pts used</div>
                    <div style={{ fontSize: "11px", color: "#aaa", marginTop: "2px" }}>Expires {formatDate(v.expiresAt)}</div>
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

// ── Main Component ────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const data    = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const [searchQ,          setSearchQ]          = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [detailCustomer,   setDetailCustomer]   = useState<any>(null);
  const [page,             setPage]             = useState(0);

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

  const totalPages    = Math.ceil(filtered.length / PAGE_SIZE);
  const pageCustomers = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Opens the modal with the full customer object (transactions + vouchers already included from loader)
  const openDetail = (c: any) => {
    setSelectedCustomer(c);
    setDetailCustomer(c);
  };

  const totalForTier = data.tierStats.reduce((s, t) => s + t.count, 0) || 1;

  const chartDays     = data.dailyStats.filter((_, i) => i % 2 === 0).map((d) => { const [,m,day] = d.date.split("-"); return `${parseInt(m)}/${parseInt(day)}`; });
  const chartIssued   = data.dailyStats.filter((_, i) => i % 2 === 0).map((d) => d.issued);
  const chartRedeemed = data.dailyStats.filter((_, i) => i % 2 === 0).map((d) => d.redeemed);

  return (
    <s-page heading="Loyalty Analytics">

      {/* ── KPI cards ── */}
      <s-section heading="Last 30 days">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
          {[
            { label: "Total members",       value: fmtNum(data.totalMembers),       sub: `+${data.newMembers30d} new this month` },
            { label: "Points issued",       value: fmtNum(data.pointsIssued30d),    sub: "This period" },
            { label: "Points redeemed",     value: fmtNum(data.pointsRedeemed30d),  sub: "This period" },
            { label: "Outstanding balance", value: fmtNum(data.outstandingBalance), sub: "Across all members" },
          ].map(({ label, value, sub }) => (
            <s-card key={label}>
              <s-stack direction="block" gap="large-200">
                <s-text tone="neutral">{label}</s-text>
                <s-heading>{value}</s-heading>
                <s-text tone="neutral">{sub}</s-text>
              </s-stack>
            </s-card>
          ))}
        </div>
      </s-section>

      {/* ── Chart ── */}
      <s-section heading="Daily activity">
        <s-card>
          <div style={{ position: "relative", width: "100%", height: "220px" }}>
            <canvas id="loyaltyChart" role="img" aria-label="Daily points chart" />
          </div>
          <div style={{ display: "flex", gap: "16px", marginTop: "12px" }}>
            {[["#97C459","Issued"],["#F09595","Redeemed"]].map(([bg, label]) => (
              <span key={label} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
                <span style={{ width: "10px", height: "10px", borderRadius: "2px", background: bg, display: "inline-block" }} />
                {label}
              </span>
            ))}
          </div>
        </s-card>
        <script dangerouslySetInnerHTML={{ __html: `(function(){var days=${JSON.stringify(chartDays)},issued=${JSON.stringify(chartIssued)},redeemed=${JSON.stringify(chartRedeemed)};function init(){if(typeof Chart==='undefined'){setTimeout(init,100);return;}var ctx=document.getElementById('loyaltyChart');if(!ctx)return;new Chart(ctx,{type:'bar',data:{labels:days,datasets:[{label:'Issued',data:issued,backgroundColor:'#97C459',borderRadius:3},{label:'Redeemed',data:redeemed,backgroundColor:'#F09595',borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{autoSkip:true,maxTicksLimit:8}},y:{beginAtZero:true,ticks:{precision:0}}}}});}var s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';s.onload=init;document.head.appendChild(s);})();` }} />
      </s-section>

      {/* ── Top customers + recent transactions ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <s-section heading="Top customers">
          <s-card>
            {data.topCustomers.length === 0 ? <s-text tone="neutral">No customers yet.</s-text> : (
              <s-resource-list>
                {data.topCustomers.map((c) => (
                  <s-resource-item key={c.shopifyCustomerId}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <s-avatar initials={initials(c.name, c.shopifyCustomerId)} />
                      <div style={{ flex: 1 }}>
                        <s-text>{c.name ?? `Customer ${c.shopifyCustomerId}`}</s-text><br />
                        <s-text tone="neutral">{fmtNum(c.totalPoints)} pts</s-text>
                      </div>
                    </div>
                  </s-resource-item>
                ))}
              </s-resource-list>
            )}
          </s-card>
        </s-section>

        <s-section heading="Recent transactions">
          <s-card>
            {data.recentTransactions.length === 0 ? <s-text tone="neutral">No transactions yet.</s-text> : (
              <s-resource-list>
                {data.recentTransactions.map((t) => {
                  const isPos = t.type === "earn" || t.type === "adjust";
                  return (
                    <s-resource-item key={t.id}>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: isPos ? "#EAF3DE" : "#FCEBEB", color: isPos ? "#3B6D11" : "#A32D2D", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: "16px", flexShrink: 0 }}>
                          {isPos ? "+" : "−"}
                        </div>
                        <div style={{ flex: 1 }}>
                          <s-text>{t.note ?? (isPos ? "Award" : "Deduction")}</s-text><br />
                          <s-text tone="neutral">{t.customerName ?? t.customerId} · {relativeTime(t.createdAt)}</s-text>
                        </div>
                        <s-text tone={isPos ? "success" : "critical"}>{isPos ? "+" : "−"}{fmtNum(t.points)}</s-text>
                      </div>
                    </s-resource-item>
                  );
                })}
              </s-resource-list>
            )}
          </s-card>
        </s-section>
      </div>

      {/* ── Tier distribution ── */}
      <s-section heading="Membership tier distribution">
        <s-card>
          <s-stack direction="block" gap="large-400">
            {data.tierStats.map(({ tier, count, threshold }) => {
              const pct = Math.round((count / totalForTier) * 100);
              const s   = TIER_STYLES[tier.toLowerCase()] ?? TIER_STYLES.bronze;
              return (
                <div key={tier}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                    <s-text>{tier} <span style={{ color: "#888", fontSize: "13px" }}>{threshold}</span></s-text>
                    <s-text tone="neutral">{fmtNum(count)} members · {pct}%</s-text>
                  </div>
                  <div style={{ height: "7px", background: "#f0f0f0", borderRadius: "4px", overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: s.bar, borderRadius: "4px", transition: "width 0.6s ease" }} />
                  </div>
                </div>
              );
            })}
          </s-stack>
        </s-card>
      </s-section>

      {/* ── Members list ── */}
      <s-section heading="All members">
        <s-card>
          <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
            <input
              type="text"
              placeholder="Search by name, email, or customer ID…"
              value={searchQ}
              onChange={(e) => { setSearchQ(e.target.value); setPage(0); }}
              style={{ ...inp, flex: 1 }}
            />
            <span style={{ fontSize: "13px", color: "#888", alignSelf: "center", whiteSpace: "nowrap" }}>
              {filtered.length} member{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 160px 120px 120px 160px", gap: "8px",
            padding: "8px 12px", background: "#f9f9f9", borderRadius: "6px", marginBottom: "4px",
            fontSize: "11px", fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            <div>Customer</div>
            <div style={{ textAlign: "center" }}>Tier</div>
            <div style={{ textAlign: "right" }}>Available</div>
            <div style={{ textAlign: "right" }}>Lifetime</div>
            <div style={{ textAlign: "center" }}>Actions</div>
          </div>

          {pageCustomers.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 0", color: "#aaa", fontSize: "14px" }}>
              {searchQ ? `No customers match "${searchQ}"` : "No members yet."}
            </div>
          ) : pageCustomers.map((c, i) => {
            const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || "No name";
            return (
              <div key={c.id} style={{ display: "grid", gridTemplateColumns: "1fr 160px 120px 120px 160px",
                gap: "8px", padding: "10px 12px", alignItems: "center",
                borderTop: "1px solid #f0f0f0",
                background: selectedCustomer?.id === c.id ? "#f0f4ff" : "transparent",
              }}>
                <div>
                  <div style={{ fontWeight: 500, fontSize: "14px", color: "#0d0d0d" }}>{name}</div>
                  <div style={{ fontSize: "12px", color: "#888" }}>{c.email ?? "No email"}</div>
                </div>
                <div style={{ textAlign: "center" }}><TierBadge tier={c.tier} /></div>
                <div style={{ textAlign: "right", fontWeight: 600, fontSize: "14px" }}>{fmtNum(c.points)}</div>
                <div style={{ textAlign: "right", fontSize: "13px", color: "#666" }}>{fmtNum(c.lifetimePoints)}</div>
                <div style={{ display: "flex", gap: "6px", justifyContent: "center" }}>
                  <button
                    onClick={() => openDetail(c)}
                    style={{ padding: "5px 10px", fontSize: "12px", fontWeight: 600, borderRadius: "5px",
                      border: "1px solid #d4a017", background: "#fefae6", color: "#92630a", cursor: "pointer" }}>
                    ✏️ Adjust
                  </button>
                  <button
                    onClick={() => openDetail(c)}
                    style={{ padding: "5px 10px", fontSize: "12px", fontWeight: 600, borderRadius: "5px",
                      border: "1px solid #c7d7ff", background: "#f0f4ff", color: "#1d4ed8", cursor: "pointer" }}>
                    👁 Details
                  </button>
                </div>
              </div>
            );
          })}

          {totalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "12px", paddingTop: "16px", marginTop: "8px", borderTop: "1px solid #f0f0f0" }}>
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                style={{ padding: "6px 14px", borderRadius: "6px", border: "1px solid #ddd", background: "#fff", cursor: page === 0 ? "not-allowed" : "pointer", color: page === 0 ? "#ccc" : "#333", fontSize: "13px" }}>
                ← Prev
              </button>
              <span style={{ fontSize: "13px", color: "#666" }}>Page {page + 1} of {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                style={{ padding: "6px 14px", borderRadius: "6px", border: "1px solid #ddd", background: "#fff", cursor: page >= totalPages - 1 ? "not-allowed" : "pointer", color: page >= totalPages - 1 ? "#ccc" : "#333", fontSize: "13px" }}>
                Next →
              </button>
            </div>
          )}
        </s-card>
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