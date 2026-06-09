import { useLoaderData, useFetcher } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useRef, useState } from "react";
import { authenticate } from "../shopify.server";
import { getLoyaltySettings, saveLoyaltySettings } from "../services/loyaltySettings.server";

declare global {
  namespace JSX { interface IntrinsicElements { [elemName: string]: any; } }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const settings = await getLoyaltySettings(session.shop);

  // Fetch store currency
  const res      = await admin.graphql(`query { shop { currencyCode } }`);
  const data     = await res.json();
  const currency = data.data?.shop?.currencyCode ?? "USD";

  return { settings, currency };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const contentType = request.headers.get("content-type") ?? "";
  let raw: Record<string, any>;
  if (contentType.includes("application/json")) { raw = await request.json(); }
  else { const fd = await request.formData(); raw = Object.fromEntries(fd.entries()); }

  const tab     = raw.tab as string;
  const current = await getLoyaltySettings(session.shop);

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

const inputStyle: React.CSSProperties = { padding: "8px 12px", border: "1px solid #ccc", borderRadius: "6px", fontSize: "14px" };

function ColorField({ label, desc, value, onChange }: { label: string; desc: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ marginBottom: "20px" }}>
      <div style={{ fontWeight: 600, marginBottom: "4px" }}>{label}</div>
      <div style={{ fontSize: "13px", color: "#666", marginBottom: "8px" }}>{desc}</div>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
          style={{ width: "44px", height: "36px", padding: "2px", border: "1px solid #ccc", borderRadius: "6px", cursor: "pointer" }} />
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
          style={{ ...inputStyle, width: "110px", fontFamily: "monospace" }} />
        <div style={{ width: "36px", height: "36px", borderRadius: "6px", background: value, border: "1px solid #ddd", flexShrink: 0 }} />
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

export default function SettingsPage() {
  const { settings, currency } = useLoaderData<typeof loader>();
  const fetcher  = useFetcher<typeof action>();
  const isSaving = fetcher.state !== "idle";
  const result   = fetcher.data;

  const [activeTab, setActiveTab] = useState<"earning"|"redemption"|"referral"|"style">("earning");

  const ppcRef    = useRef<HTMLInputElement>(null);
  const oatRef    = useRef<HTMLSelectElement>(null);
  const bronzeRef = useRef<HTMLInputElement>(null);
  const silverRef = useRef<HTMLInputElement>(null);
  const goldRef   = useRef<HTMLInputElement>(null);

  const bronzeRateRef = useRef<HTMLInputElement>(null);
  const silverRateRef = useRef<HTMLInputElement>(null);
  const goldRateRef   = useRef<HTMLInputElement>(null);
  const preset1Ref    = useRef<HTMLInputElement>(null);
  const preset2Ref    = useRef<HTMLInputElement>(null);
  const preset3Ref    = useRef<HTMLInputElement>(null);

  // Redemption live state — drives the preview table
  const [bronzeRate, setBronzeRate] = useState(settings.bronzeRedemptionRate ?? 100);
  const [silverRate, setSilverRate] = useState(settings.silverRedemptionRate ?? 80);
  const [goldRate,   setGoldRate]   = useState(settings.goldRedemptionRate   ?? 60);
  const [p1, setP1] = useState(settings.voucherPreset1 ?? 500);
  const [p2, setP2] = useState(settings.voucherPreset2 ?? 1000);
  const [p3, setP3] = useState(settings.voucherPreset3 ?? 2000);

  // Referral state
  const [signupBonus,  setSignupBonus]  = useState(settings.referralSignupBonus ?? 100);
  const [referrerPct,  setReferrerPct]  = useState(settings.referralReferrerPct ?? 10);
  const [refereePct,   setRefereePct]   = useState(settings.referralRefereePct  ?? 10);

  const [accentColor,     setAccentColor]     = useState(settings.accentColor     ?? "#d4a017");
  const [bgColor,         setBgColor]         = useState(settings.bgColor         ?? "#0d0d0d");
  const [textColor,       setTextColor]       = useState(settings.textColor       ?? "#ffffff");
  const [buttonColor,     setButtonColor]     = useState(settings.buttonColor     ?? "#d4a017");
  const [buttonTextColor, setButtonTextColor] = useState(settings.buttonTextColor ?? "#0d0d0d");
  const [borderRadius,    setBorderRadius]    = useState(settings.borderRadius    ?? 16);

  const handleSaveEarning = () => fetcher.submit({
    tab: "earning",
    pointsPerCurrency: Number(ppcRef.current?.value    ?? settings.pointsPerCurrency),
    orderAmountType:          oatRef.current?.value    ?? settings.orderAmountType,
    bronzeMultiplier:  Number(bronzeRef.current?.value ?? settings.bronzeMultiplier),
    silverMultiplier:  Number(silverRef.current?.value ?? settings.silverMultiplier),
    goldMultiplier:    Number(goldRef.current?.value   ?? settings.goldMultiplier),
  }, { method: "POST", encType: "application/json" });

  const handleSaveRedemption = () => fetcher.submit({
    tab: "redemption",
    bronzeRedemptionRate: bronzeRate,
    silverRedemptionRate: silverRate,
    goldRedemptionRate:   goldRate,
    voucherPreset1: p1, voucherPreset2: p2, voucherPreset3: p3,
  }, { method: "POST", encType: "application/json" });

  const handleSaveReferral = () => fetcher.submit({
    tab: "referral",
    referralSignupBonus: signupBonus,
    referralReferrerPct: referrerPct,
    referralRefereePct:  refereePct,
  }, { method: "POST", encType: "application/json" });

  const handleSaveStyle = () => fetcher.submit(
    { tab: "style", accentColor, bgColor, textColor, buttonColor, buttonTextColor, borderRadius },
    { method: "POST", encType: "application/json" },
  );

  const showSuccess = result?.ok === true  && result?.tab === activeTab;
  const showErrors  = result?.ok === false && result?.tab === activeTab && (result?.errors?.length ?? 0) > 0;

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "10px 20px", fontSize: "14px", fontWeight: active ? 600 : 400,
    color: active ? "#0d0d0d" : "#6d7175", cursor: "pointer",
    background: "none", border: "none",
    borderBottomWidth: "2px", borderBottomStyle: "solid",
    borderBottomColor: active ? "#0d0d0d" : "transparent",
    marginBottom: "-1px",
  });

  return (
    <s-page heading="Loyalty Settings">
      <s-section>
        <s-card>
          <div style={{ display: "flex", borderBottom: "1px solid #e1e3e5", marginBottom: "24px" }}>
            <button style={tabStyle(activeTab === "earning")}    onClick={() => setActiveTab("earning")}>Earning Rules</button>
            <button style={tabStyle(activeTab === "redemption")} onClick={() => setActiveTab("redemption")}>Redemption</button>
            <button style={tabStyle(activeTab === "referral")}   onClick={() => setActiveTab("referral")}>Referral</button>
            <button style={tabStyle(activeTab === "style")}      onClick={() => setActiveTab("style")}>Widget Style</button>
          </div>

          {showSuccess && (
            <div style={{ background: "#EAF3DE", border: "1px solid #97C459", borderRadius: "8px", padding: "12px 16px", marginBottom: "20px", color: "#3B6D11", fontSize: "14px" }}>
              ✓ Settings saved successfully.
            </div>
          )}
          {showErrors && (
            <div style={{ background: "#FCEBEB", border: "1px solid #F09595", borderRadius: "8px", padding: "12px 16px", marginBottom: "20px", color: "#A32D2D", fontSize: "14px" }}>
              {result!.errors!.map((e: string) => <div key={e}>⚠ {e}</div>)}
            </div>
          )}

          {/* ── EARNING TAB ── */}
          {activeTab === "earning" && (
            <s-stack direction="block" gap="large-400">
              <div>
                <div style={{ fontWeight: 600, marginBottom: "6px" }}>Points per currency unit</div>
                <div style={{ fontSize: "13px", color: "#666", marginBottom: "10px" }}>How many points a customer earns per 1 {currency} spent.</div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input ref={ppcRef} type="number" defaultValue={settings.pointsPerCurrency} min={0.1} step={0.1} style={{ ...inputStyle, width: "120px" }} />
                  <span style={{ fontSize: "13px", color: "#888" }}>pts per 1 {currency}</span>
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 600, marginBottom: "6px" }}>Base order amount on</div>
                <div style={{ fontSize: "13px", color: "#666", marginBottom: "10px" }}>Subtotal or total (inc. shipping + tax).</div>
                <select ref={oatRef} defaultValue={settings.orderAmountType} style={{ ...inputStyle, background: "#fff", cursor: "pointer" }}>
                  <option value="subtotal">Subtotal (products only)</option>
                  <option value="total">Total (including shipping &amp; tax)</option>
                </select>
              </div>
              <div style={{ background: "#F6F6F7", borderRadius: "8px", padding: "12px 16px", fontSize: "13px", color: "#444" }}>
                <strong>Formula:</strong> <code>floor(orderAmount × pointsPerCurrency × tierMultiplier)</code><br />
                <span style={{ color: "#888" }}>Example: {formatCurrency(50, currency)} order · 10 pts/{currency} · Gold 1.5× = <strong>750 pts</strong></span>
              </div>
              {[
                { ref: bronzeRef, emoji: "🥉", label: "Bronze multiplier", color: "#D85A30", note: "(base rate)", val: settings.bronzeMultiplier },
                { ref: silverRef, emoji: "🥈", label: "Silver multiplier", color: "#5F5E5A", note: "",            val: settings.silverMultiplier },
                { ref: goldRef,   emoji: "🥇", label: "Gold multiplier",   color: "#BA7517", note: "",            val: settings.goldMultiplier   },
              ].map(({ ref, emoji, label, color, note, val }) => (
                <div key={label}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <span style={{ fontSize: "18px" }}>{emoji}</span>
                    <strong style={{ color }}>{label}</strong>
                    {note && <span style={{ fontSize: "12px", color: "#888" }}>{note}</span>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input ref={ref} type="number" defaultValue={val} min={0.1} step={0.05} style={{ ...inputStyle, width: "100px" }} />
                    <span style={{ fontSize: "13px", color: "#888" }}>×</span>
                  </div>
                </div>
              ))}
              <div><s-button variant="primary" onClick={handleSaveEarning} {...(isSaving ? { loading: true } : {})}>{isSaving ? "Saving…" : "Save settings"}</s-button></div>
            </s-stack>
          )}

          {/* ── REDEMPTION TAB ── */}
          {activeTab === "redemption" && (
            <s-stack direction="block" gap="large-400">
              <div>
                <div style={{ fontWeight: 600, fontSize: "15px", marginBottom: "4px" }}>Redemption rates</div>
                <div style={{ fontSize: "13px", color: "#666", marginBottom: "16px" }}>
                  How many points equal 1 {currency} of discount. Lower = better value for customer.
                </div>
                {[
                  { ref: bronzeRateRef, emoji: "🥉", label: "Bronze rate", color: "#D85A30", val: bronzeRate, set: (v: number) => { setBronzeRate(v); } },
                  { ref: silverRateRef, emoji: "🥈", label: "Silver rate", color: "#5F5E5A", val: silverRate, set: (v: number) => { setSilverRate(v); } },
                  { ref: goldRateRef,   emoji: "🥇", label: "Gold rate",   color: "#BA7517", val: goldRate,   set: (v: number) => { setGoldRate(v); }   },
                ].map(({ ref, emoji, label, color, val, set }) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
                    <span style={{ fontSize: "18px" }}>{emoji}</span>
                    <strong style={{ color, minWidth: "110px" }}>{label}</strong>
                    <input
                      ref={ref}
                      type="number"
                      value={val}
                      min={1}
                      step={1}
                      onChange={(e) => set(Number(e.target.value) || 1)}
                      style={{ ...inputStyle, width: "90px" }}
                    />
                    <span style={{ fontSize: "13px", color: "#888" }}>pts = 1 {currency}</span>
                  </div>
                ))}
              </div>

              <div>
                <div style={{ fontWeight: 600, fontSize: "15px", marginBottom: "4px" }}>Voucher presets</div>
                <div style={{ fontSize: "13px", color: "#666", marginBottom: "16px" }}>
                  The 3 point amounts customers can choose from when redeeming.
                </div>
                <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                  {[
                    { ref: preset1Ref, label: "Small",  val: p1, set: setP1 },
                    { ref: preset2Ref, label: "Medium", val: p2, set: setP2 },
                    { ref: preset3Ref, label: "Large",  val: p3, set: setP3 },
                  ].map(({ ref, label, val, set }) => (
                    <div key={label} style={{ background: "#f9f9f9", borderRadius: "8px", padding: "14px 16px", minWidth: "150px" }}>
                      <div style={{ fontSize: "12px", color: "#888", marginBottom: "6px" }}>{label} voucher</div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <input
                          ref={ref}
                          type="number"
                          value={val}
                          min={1}
                          step={50}
                          onChange={(e) => set(Number(e.target.value) || 1)}
                          style={{ ...inputStyle, width: "90px" }}
                        />
                        <span style={{ fontSize: "13px", color: "#888" }}>pts</span>
                      </div>
                      <div style={{ fontSize: "11px", color: "#666", marginTop: "6px" }}>
                        Bronze: {formatCurrency(val / bronzeRate, currency)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Live preview table */}
              <div style={{ background: "#F6F6F7", borderRadius: "8px", padding: "16px" }}>
                <div style={{ fontWeight: 600, marginBottom: "10px", fontSize: "13px" }}>Discount value preview ({currency})</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ color: "#888" }}>
                      <th style={{ textAlign: "left",  paddingBottom: "8px" }}>Points</th>
                      <th style={{ textAlign: "right", paddingBottom: "8px" }}>🥉 Bronze</th>
                      <th style={{ textAlign: "right", paddingBottom: "8px" }}>🥈 Silver</th>
                      <th style={{ textAlign: "right", paddingBottom: "8px" }}>🥇 Gold</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[p1, p2, p3].map((pts) => (
                      <tr key={pts} style={{ borderTop: "1px solid #e8e8e8" }}>
                        <td style={{ padding: "8px 0", fontWeight: 600 }}>{pts.toLocaleString()} pts</td>
                        <td style={{ textAlign: "right", padding: "8px 0" }}>{formatCurrency(pts / bronzeRate, currency)}</td>
                        <td style={{ textAlign: "right", padding: "8px 0" }}>{formatCurrency(pts / silverRate, currency)}</td>
                        <td style={{ textAlign: "right", padding: "8px 0", color: "#BA7517", fontWeight: 600 }}>{formatCurrency(pts / goldRate, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div><s-button variant="primary" onClick={handleSaveRedemption} {...(isSaving ? { loading: true } : {})}>{isSaving ? "Saving…" : "Save redemption settings"}</s-button></div>
            </s-stack>
          )}

          {/* ── REFERRAL TAB ── */}
          {activeTab === "referral" && (
            <s-stack direction="block" gap="large-400">
              <div style={{ background: "#f0f4ff", border: "1px solid #c7d7ff", borderRadius: "8px", padding: "12px 16px", fontSize: "13px", color: "#1d4ed8" }}>
                ℹ️ Customers share their unique referral code. When a friend signs up using it, both get bonus points.
              </div>

              <div>
                <div style={{ fontWeight: 600, fontSize: "15px", marginBottom: "4px" }}>Signup bonus</div>
                <div style={{ fontSize: "13px", color: "#666", marginBottom: "10px" }}>Points awarded to the referee immediately on enrollment.</div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input type="number" min={0} step={10} value={signupBonus}
                    onChange={(e) => setSignupBonus(Number(e.target.value))}
                    style={{ ...inputStyle, width: "100px" }} />
                  <span style={{ fontSize: "13px", color: "#888" }}>pts to new member on signup</span>
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 600, fontSize: "15px", marginBottom: "4px" }}>First order bonus</div>
                <div style={{ fontSize: "13px", color: "#666", marginBottom: "16px" }}>
                  When the referee completes their first order, both parties earn a % of the base order points.
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ minWidth: "80px", fontSize: "13px", fontWeight: 600 }}>Referrer gets</span>
                    <input type="number" min={0} max={100} step={1} value={referrerPct}
                      onChange={(e) => setReferrerPct(Number(e.target.value))}
                      style={{ ...inputStyle, width: "80px" }} />
                    <span style={{ fontSize: "13px", color: "#888" }}>% of referee's first order points</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ minWidth: "80px", fontSize: "13px", fontWeight: 600 }}>Referee gets</span>
                    <input type="number" min={0} max={100} step={1} value={refereePct}
                      onChange={(e) => setRefereePct(Number(e.target.value))}
                      style={{ ...inputStyle, width: "80px" }} />
                    <span style={{ fontSize: "13px", color: "#888" }}>% bonus on top of their own order points</span>
                  </div>
                </div>
              </div>

              <div style={{ background: "#F6F6F7", borderRadius: "8px", padding: "14px 16px", fontSize: "13px" }}>
                <strong>Example:</strong> Referee places a {currency ?? ""} 50 order earning 500 pts base.
                Referrer gets <strong>{Math.floor(500 * referrerPct / 100)} pts</strong> bonus.
                Referee gets <strong>{Math.floor(500 * refereePct / 100)} pts</strong> extra bonus.
              </div>

              <div><s-button variant="primary" onClick={handleSaveReferral} {...(isSaving ? { loading: true } : {})}>{isSaving ? "Saving…" : "Save referral settings"}</s-button></div>
            </s-stack>
          )}

  
          {activeTab === "style" && (
            <div style={{ display: "flex", gap: "40px", alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ flex: "1", minWidth: "280px" }}>
                <ColorField label="Accent color"      desc="Progress bar, highlights, badges."  value={accentColor}     onChange={setAccentColor} />
                <ColorField label="Card background"   desc="Background of the widget card."     value={bgColor}         onChange={setBgColor} />
                <ColorField label="Text color"        desc="Primary text on the widget."        value={textColor}       onChange={setTextColor} />
                <ColorField label="Button color"      desc="CTA button background."             value={buttonColor}     onChange={setButtonColor} />
                <ColorField label="Button text color" desc="Text on the CTA button."            value={buttonTextColor} onChange={setButtonTextColor} />
                <div style={{ marginBottom: "24px" }}>
                  <div style={{ fontWeight: 600, marginBottom: "4px" }}>Border radius</div>
                  <div style={{ fontSize: "13px", color: "#666", marginBottom: "8px" }}>Corner rounding on cards (px).</div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <input type="range" min={0} max={32} value={borderRadius} onChange={(e) => setBorderRadius(Number(e.target.value))} style={{ width: "140px", cursor: "pointer" }} />
                    <input type="number" min={0} max={32} value={borderRadius} onChange={(e) => setBorderRadius(Number(e.target.value))} style={{ ...inputStyle, width: "70px" }} />
                    <span style={{ fontSize: "13px", color: "#888" }}>px</span>
                  </div>
                </div>
                <s-button variant="primary" onClick={handleSaveStyle} {...(isSaving ? { loading: true } : {})}>{isSaving ? "Saving…" : "Save style"}</s-button>
              </div>
              <div style={{ flex: "1", minWidth: "260px" }}>
                <div style={{ fontSize: "12px", fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "12px" }}>Live preview</div>
                <div style={{ background: bgColor, borderRadius: `${borderRadius}px`, padding: "28px 24px", fontFamily: "'DM Sans', sans-serif", boxShadow: "0 4px 24px rgba(0,0,0,0.12)" }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "5px", background: `${accentColor}22`, border: `1px solid ${accentColor}66`, borderRadius: "999px", padding: "3px 10px", fontSize: "10px", fontWeight: 600, color: accentColor, textTransform: "uppercase", marginBottom: "14px" }}>✦ Loyalty</div>
                  <div style={{ color: textColor, fontSize: "36px", fontWeight: 700, lineHeight: 1, marginBottom: "4px" }}>1,250</div>
                  <div style={{ color: `${textColor}88`, fontSize: "13px", marginBottom: "16px" }}>points available</div>
                  <div style={{ height: "6px", background: `${textColor}18`, borderRadius: "999px", overflow: "hidden", marginBottom: "16px" }}>
                    <div style={{ width: "62%", height: "100%", background: accentColor, borderRadius: "999px" }} />
                  </div>
                  <div style={{ background: buttonColor, color: buttonTextColor, borderRadius: `${Math.max(4, borderRadius - 4)}px`, padding: "11px 20px", fontSize: "14px", fontWeight: 600, textAlign: "center" }}>Redeem Points</div>
                </div>
                <div style={{ fontSize: "11px", color: "#aaa", marginTop: "10px", textAlign: "center" }}>Preview only</div>
              </div>
            </div>
          )}
        </s-card>
      </s-section>

      <s-section heading="Points lifecycle">
        <s-card>
          <s-stack direction="block" gap="large-300">
            {[
              { icon: "🛒", label: "Order paid",      desc: "Points awarded as Pending — visible but not spendable." },
              { icon: "📦", label: "Order fulfilled",  desc: "Pending points become Active — customer can now spend them." },
              { icon: "❌", label: "Order cancelled",  desc: "Pending points voided; Active points deducted." },
              { icon: "🎟️", label: "Points redeemed",  desc: `Customer redeems points for a one-time ${currency} discount code (30-day expiry).` },
            ].map(({ icon, label, desc }) => (
              <div key={label} style={{ display: "flex", gap: "12px", alignItems: "flex-start", padding: "10px 0", borderBottom: "0.5px solid #eee" }}>
                <span style={{ fontSize: "20px", flexShrink: 0 }}>{icon}</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: "14px" }}>{label}</div>
                  <div style={{ fontSize: "13px", color: "#666", marginTop: "2px" }}>{desc}</div>
                </div>
              </div>
            ))}
          </s-stack>
        </s-card>
      </s-section>
    </s-page>
  );
}