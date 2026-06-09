import { useLoaderData, useFetcher } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useState, useRef } from "react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

declare global {
  namespace JSX { interface IntrinsicElements { [elemName: string]: any; } }
}

// ── Loader ────────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url  = new URL(request.url);
  const q    = url.searchParams.get("q")?.trim() ?? "";

  if (!q) return { shop, q, customers: [], selected: null };

  // Search by name, email, or shopifyCustomerId
  const customers = await db.loyaltyCustomer.findMany({
    where: {
      shop,
      OR: [
        { email:             { contains: q } },
        { firstName:         { contains: q } },
        { lastName:          { contains: q } },
        { shopifyCustomerId: { contains: q } },
      ],
    },
    orderBy: { lifetimePoints: "desc" },
    take: 20,
  });

  // If a specific customer is selected, load full detail
  const selectedId = url.searchParams.get("customerId");
  let selected: any = null;

  if (selectedId) {
    const customer = await db.loyaltyCustomer.findUnique({
      where: { id: selectedId },
      include: {
        transactions: { orderBy: { createdAt: "desc" }, take: 50 },
        vouchers:     { orderBy: { createdAt: "desc" }, take: 20  },
      },
    });
    selected = customer ?? null;
  }

  return { shop, q, customers, selected };
};

// ── Action ────────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const contentType = request.headers.get("content-type") ?? "";
  let raw: Record<string, any>;
  if (contentType.includes("application/json")) { raw = await request.json(); }
  else { const fd = await request.formData(); raw = Object.fromEntries(fd.entries()); }

  const { intent, customerId, points, note } = raw;

  if (!customerId) return { ok: false, error: "Missing customerId" };

  const customer = await db.loyaltyCustomer.findUnique({ where: { id: customerId } });
  if (!customer || customer.shop !== shop) return { ok: false, error: "Customer not found" };

  const pts = Number(points);
  if (isNaN(pts) || pts <= 0) return { ok: false, error: "Points must be a positive number" };

  if (intent === "add") {
    await db.$transaction([
      db.loyaltyCustomer.update({
        where: { id: customerId },
        data: {
          points:        { increment: pts },
          lifetimePoints: { increment: pts },
        },
      }),
      db.pointTransaction.create({
        data: {
          shop,
          customerId,
          type:   "adjust",
          points: pts,
          status: "active",
          note:   note ? String(note) : `Manual adjustment by merchant (+${pts} pts)`,
        },
      }),
    ]);

    // Sync metafield + evaluate tier
    const updated = await db.loyaltyCustomer.findUnique({ where: { id: customerId } });
    if (updated) {
      try {
        const { syncPointsMetafield } = await import("../services/points.server");
        const { evaluateAndUpdateTier } = await import("../services/tierService");
        await syncPointsMetafield(admin, updated.shopifyCustomerId, updated.points);
        await evaluateAndUpdateTier({
          id: updated.id, shopifyCustomerId: updated.shopifyCustomerId,
          shop: updated.shop, lifetimePoints: updated.lifetimePoints, tier: updated.tier,
        }, admin);
      } catch (e) { console.error("[customers] metafield sync error:", e); }
    }

    return { ok: true, intent, pts, customerId };
  }

  if (intent === "deduct") {
    if (customer.points < pts) return { ok: false, error: `Customer only has ${customer.points} points` };

    await db.$transaction([
      db.loyaltyCustomer.update({
        where: { id: customerId },
        data: { points: { decrement: pts } },
      }),
      db.pointTransaction.create({
        data: {
          shop,
          customerId,
          type:   "adjust",
          points: -pts,
          status: "active",
          note:   note ? String(note) : `Manual deduction by merchant (−${pts} pts)`,
        },
      }),
    ]);

    const updated = await db.loyaltyCustomer.findUnique({ where: { id: customerId } });
    if (updated) {
      try {
        const { syncPointsMetafield } = await import("../services/points.server");
        await syncPointsMetafield(admin, updated.shopifyCustomerId, updated.points);
      } catch (e) { console.error("[customers] metafield sync error:", e); }
    }

    return { ok: true, intent, pts, customerId };
  }

  return { ok: false, error: "Unknown intent" };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const TIER_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  bronze: { bg: "#fdf0e6", text: "#b85c1a", border: "#f0c090" },
  silver: { bg: "#f0f2f5", text: "#4a5568", border: "#c0c8d8" },
  gold:   { bg: "#fefae6", text: "#92630a", border: "#f0d060" },
};

const TIER_ICONS: Record<string, string> = { bronze: "🥉", silver: "🥈", gold: "🥇" };

function TierBadge({ tier }: { tier: string }) {
  const c = TIER_COLORS[tier] ?? TIER_COLORS.bronze;
  return (
    <span style={{
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
      borderRadius: "999px", padding: "2px 10px", fontSize: "12px", fontWeight: 600,
      textTransform: "capitalize",
    }}>
      {TIER_ICONS[tier] ?? "🥉"} {tier}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
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
  padding: "8px 12px", border: "1px solid #ccc", borderRadius: "6px",
  fontSize: "14px", width: "100%", boxSizing: "border-box",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function CustomersPage() {
  const { q, customers, selected } = useLoaderData<typeof loader>();
  const fetcher     = useFetcher<typeof action>();
  const searchFetch = useFetcher();

  const [activeCustomer, setActiveCustomer] = useState<any>(selected ?? null);
  const [searchQ, setSearchQ]               = useState(q ?? "");
  const [adjustTab, setAdjustTab]           = useState<"add" | "deduct">("add");
  const [adjustPts, setAdjustPts]           = useState("");
  const [adjustNote, setAdjustNote]         = useState("");

  const isSaving = fetcher.state !== "idle";
  const result   = fetcher.data as any;

  // Update active customer balance optimistically after save
  const displayCustomer = (() => {
    if (!activeCustomer) return null;
    if (result?.ok && result?.customerId === activeCustomer.id) {
      const delta = result.intent === "add" ? result.pts : -result.pts;
      return {
        ...activeCustomer,
        points: activeCustomer.points + (result.intent === "deduct" ? -result.pts : result.pts),
        lifetimePoints: result.intent === "add"
          ? activeCustomer.lifetimePoints + result.pts
          : activeCustomer.lifetimePoints,
      };
    }
    return activeCustomer;
  })();

  const handleSearch = () => {
    searchFetch.load(`/app/customers?q=${encodeURIComponent(searchQ)}`);
    setActiveCustomer(null);
  };

  const handleSelectCustomer = (c: any) => {
    searchFetch.load(`/app/customers?q=${encodeURIComponent(searchQ)}&customerId=${c.id}`);
    setActiveCustomer(c);
    setAdjustPts("");
    setAdjustNote("");
  };

  // When search returns with customer detail, update activeCustomer
  const searchData = searchFetch.data as any;
  const searchCustomers = searchData?.customers ?? customers;
  if (searchData?.selected && searchData.selected.id !== activeCustomer?.id) {
    // Will update on next render via useEffect — use ref trick
  }

  const fullCustomer = searchData?.selected ?? activeCustomer;

  const handleAdjust = () => {
    if (!fullCustomer || !adjustPts) return;
    fetcher.submit({
      intent:     adjustTab,
      customerId: fullCustomer.id,
      points:     Number(adjustPts),
      note:       adjustNote,
    }, { method: "POST", encType: "application/json" });
    setAdjustPts("");
    setAdjustNote("");
  };

  return (
    <s-page heading="Customer Loyalty">
      <s-section>
        <s-card>
          {/* Search bar */}
          <div style={{ display: "flex", gap: "10px", marginBottom: "24px" }}>
            <input
              type="text"
              placeholder="Search by name, email, or customer ID…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onKeyDown={(e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    handleSearch();
  }
}}
              style={{ ...inp, flex: 1 }}
            />
            <s-button onClick={handleSearch}>Search</s-button>
          </div>

          <div style={{ display: "flex", gap: "24px", alignItems: "flex-start" }}>

            {/* ── Customer list ── */}
            <div style={{ width: "300px", flexShrink: 0 }}>
              {searchCustomers.length === 0 && searchQ && (
                <div style={{ color: "#888", fontSize: "14px", padding: "20px 0", textAlign: "center" }}>
                  No customers found for "{searchQ}"
                </div>
              )}
              {searchCustomers.length === 0 && !searchQ && (
                <div style={{ color: "#aaa", fontSize: "13px", padding: "20px 0", textAlign: "center" }}>
                  Search to find customers
                </div>
              )}
              {searchCustomers.map((c: any) => {
                const isActive = fullCustomer?.id === c.id;
                return (
                  <div
                    key={c.id}
                    onClick={() => handleSelectCustomer(c)}
                    style={{
                      padding: "12px 14px", borderRadius: "8px", cursor: "pointer",
                      marginBottom: "6px",
                      background: isActive ? "#f0f4ff" : "#fafafa",
                      border: `1px solid ${isActive ? "#c7d7ff" : "#efefef"}`,
                      transition: "all 0.1s",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <div style={{ fontWeight: 600, fontSize: "14px", color: "#0d0d0d" }}>
                        {c.firstName || c.lastName
                          ? `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim()
                          : "No name"}
                      </div>
                      <TierBadge tier={c.tier} />
                    </div>
                    <div style={{ fontSize: "12px", color: "#666" }}>{c.email ?? "No email"}</div>
                    <div style={{ fontSize: "12px", color: "#888", marginTop: "2px" }}>
                      {c.points.toLocaleString()} pts available · {c.lifetimePoints.toLocaleString()} lifetime
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Customer detail ── */}
            {fullCustomer ? (
              <div style={{ flex: 1, minWidth: 0 }}>

                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
                  <div>
                    <div style={{ fontSize: "20px", fontWeight: 700, color: "#0d0d0d", marginBottom: "4px" }}>
                      {fullCustomer.firstName || fullCustomer.lastName
                        ? `${fullCustomer.firstName ?? ""} ${fullCustomer.lastName ?? ""}`.trim()
                        : "No name"}
                    </div>
                    <div style={{ fontSize: "13px", color: "#666" }}>{fullCustomer.email ?? "No email"}</div>
                    <div style={{ fontSize: "12px", color: "#aaa", marginTop: "2px" }}>ID: {fullCustomer.shopifyCustomerId}</div>
                  </div>
                  <TierBadge tier={fullCustomer.tier} />
                </div>

                {/* Stats row */}
                <div style={{ display: "flex", gap: "12px", marginBottom: "24px", flexWrap: "wrap" }}>
                  {[
                    { label: "Available points", value: (displayCustomer?.points ?? fullCustomer.points).toLocaleString(), accent: true },
                    { label: "Lifetime points",  value: (displayCustomer?.lifetimePoints ?? fullCustomer.lifetimePoints).toLocaleString(), accent: false },
                    { label: "Member since",     value: formatDate(fullCustomer.createdAt), accent: false },
                  ].map(({ label, value, accent }) => (
                    <div key={label} style={{
                      background: accent ? "#f0f4ff" : "#fafafa",
                      border: `1px solid ${accent ? "#c7d7ff" : "#efefef"}`,
                      borderRadius: "8px", padding: "12px 16px", minWidth: "130px",
                    }}>
                      <div style={{ fontSize: "11px", color: "#888", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
                      <div style={{ fontSize: "20px", fontWeight: 700, color: accent ? "#1d4ed8" : "#0d0d0d" }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* ── Adjust points ── */}
                <div style={{ background: "#fafafa", border: "1px solid #efefef", borderRadius: "10px", padding: "16px 20px", marginBottom: "24px" }}>
                  <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "14px" }}>Adjust points</div>

                  {result?.ok === true && result?.customerId === fullCustomer.id && (
                    <div style={{ background: "#EAF3DE", border: "1px solid #97C459", borderRadius: "6px", padding: "10px 14px", marginBottom: "12px", fontSize: "13px", color: "#3B6D11" }}>
                      ✓ {result.intent === "add" ? `+${result.pts}` : `−${result.pts}`} points applied successfully.
                    </div>
                  )}
                  {result?.ok === false && (
                    <div style={{ background: "#FCEBEB", border: "1px solid #F09595", borderRadius: "6px", padding: "10px 14px", marginBottom: "12px", fontSize: "13px", color: "#A32D2D" }}>
                      ⚠ {result.error}
                    </div>
                  )}

                  {/* Tab toggle */}
                  <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
                    {(["add", "deduct"] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setAdjustTab(t)}
                        style={{
                          padding: "6px 16px", borderRadius: "6px", fontSize: "13px", fontWeight: 600,
                          cursor: "pointer", border: "none",
                          background: adjustTab === t ? (t === "add" ? "#d1fae5" : "#fee2e2") : "#efefef",
                          color: adjustTab === t ? (t === "add" ? "#065f46" : "#991b1b") : "#666",
                        }}
                      >
                        {t === "add" ? "➕ Add points" : "➖ Deduct points"}
                      </button>
                    ))}
                  </div>

                  <div style={{ display: "flex", gap: "10px", alignItems: "flex-end", flexWrap: "wrap" }}>
                    <div style={{ flex: "0 0 120px" }}>
                      <div style={{ fontSize: "12px", color: "#666", marginBottom: "4px" }}>Points</div>
                      <input
                        type="number"
                        min={1}
                        value={adjustPts}
                        onChange={(e) => setAdjustPts(e.target.value)}
                        placeholder="e.g. 100"
                        style={{ ...inp }}
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: "160px" }}>
                      <div style={{ fontSize: "12px", color: "#666", marginBottom: "4px" }}>Note (optional)</div>
                      <input
                        type="text"
                        value={adjustNote}
                        onChange={(e) => setAdjustNote(e.target.value)}
                        placeholder="Reason for adjustment…"
                        style={{ ...inp }}
                      />
                    </div>
                    <div>
                      <s-button
                        variant={adjustTab === "add" ? "primary" : "secondary"}
                        onClick={handleAdjust}
                        {...(isSaving ? { loading: true } : {})}
                        disabled={!adjustPts || isSaving}
                      >
                        {isSaving ? "Saving…" : adjustTab === "add" ? "Add points" : "Deduct points"}
                      </s-button>
                    </div>
                  </div>
                </div>

                {/* ── Active vouchers ── */}
                {fullCustomer.vouchers && fullCustomer.vouchers.length > 0 && (
                  <div style={{ marginBottom: "24px" }}>
                    <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "12px" }}>Active vouchers</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                      {fullCustomer.vouchers
                        .filter((v: any) => v.status === "active" && new Date(v.expiresAt) > new Date())
                        .map((v: any) => (
                          <div key={v.id} style={{
                            background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px",
                            padding: "10px 14px", minWidth: "180px",
                          }}>
                            <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: "15px", color: "#1d4ed8", marginBottom: "4px" }}>
                              {v.code}
                            </div>
                            <div style={{ fontSize: "12px", color: "#666" }}>{v.discountAmount} off · {v.pointsUsed} pts</div>
                            <div style={{ fontSize: "11px", color: "#aaa", marginTop: "2px" }}>Expires {formatDate(v.expiresAt)}</div>
                          </div>
                        ))}
                    </div>
                    {fullCustomer.vouchers.filter((v: any) => v.status === "active" && new Date(v.expiresAt) > new Date()).length === 0 && (
                      <div style={{ fontSize: "13px", color: "#aaa" }}>No active vouchers</div>
                    )}
                  </div>
                )}

                {/* ── Transaction history ── */}
                <div>
                  <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "12px" }}>
                    Transaction history
                    {fullCustomer.transactions && (
                      <span style={{ fontWeight: 400, color: "#888", fontSize: "13px", marginLeft: "8px" }}>
                        ({fullCustomer.transactions.length} shown)
                      </span>
                    )}
                  </div>
                  {fullCustomer.transactions && fullCustomer.transactions.length > 0 ? (
                    <div style={{ border: "1px solid #efefef", borderRadius: "8px", overflow: "hidden" }}>
                      {fullCustomer.transactions.map((tx: any, i: number) => {
                        const badge = txBadge(tx.type, tx.status);
                        const isPos = tx.points > 0;
                        return (
                          <div key={tx.id} style={{
                            display: "flex", alignItems: "center", gap: "12px",
                            padding: "10px 14px",
                            borderTop: i === 0 ? "none" : "1px solid #f5f5f5",
                            background: i % 2 === 0 ? "#fff" : "#fafafa",
                          }}>
                            <span style={{
                              background: badge.bg, color: badge.color,
                              borderRadius: "999px", padding: "2px 8px",
                              fontSize: "11px", fontWeight: 600, flexShrink: 0,
                            }}>
                              {badge.label}
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: "13px", color: "#333", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {tx.note ?? (tx.orderName ? `Order ${tx.orderName}` : tx.type)}
                              </div>
                              <div style={{ fontSize: "11px", color: "#aaa", marginTop: "1px" }}>{formatDate(tx.createdAt)}</div>
                            </div>
                            <div style={{
                              fontSize: "14px", fontWeight: 700, flexShrink: 0,
                              color: isPos ? "#065f46" : "#991b1b",
                            }}>
                              {isPos ? "+" : ""}{tx.points.toLocaleString()}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ fontSize: "13px", color: "#aaa", padding: "20px 0" }}>No transactions yet.</div>
                  )}
                </div>

              </div>
            ) : (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 0", color: "#aaa", fontSize: "14px" }}>
                {searchCustomers.length > 0 ? "Select a customer to view details" : "Search for a customer to get started"}
              </div>
            )}
          </div>
        </s-card>
      </s-section>
    </s-page>
  );
}
