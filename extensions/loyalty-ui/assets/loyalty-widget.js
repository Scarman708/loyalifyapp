(function () {
  "use strict";

  const _root      = document.getElementById("loyalty-widget-root");
  const APP_URL    = window.__LOYALTY_APP_URL__ || (_root && _root.dataset.appUrl) || "";
  const SHOP       = window.__LOYALTY_SHOP__    || (Shopify && Shopify.shop) || "";
  const CUSTOMER_ID = window.__LOYALTY_CUSTOMER_ID__ || null;
// ✅ ADD THIS — read referral code from ?ref= URL param once on load
const REF_CODE = new URLSearchParams(window.location.search).get("ref") || null;

  const TIER_ICONS = { bronze: "🥉", silver: "🥈", gold: "🥇" };
  const TIER_HERO  = {
    bronze: { bg: "#f5e6d3", accent: "#c8813a" },
    silver: { bg: "#e8edf2", accent: "#8899aa" },
    gold:   { bg: "#fdf3d0", accent: "#d4a017" },
  };

  // ── Styles ──────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById("loyalty-widget-styles")) return;
    const style = document.createElement("style");
    style.id = "loyalty-widget-styles";
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@400;500;600&display=swap');

      .lw-root {
        font-family: 'DM Sans', sans-serif;
        --lw-radius:   16px;
        --lw-shadow:   0 4px 24px rgba(0,0,0,0.08);
        --lw-accent:   #d4a017;
        --lw-bg:       #0d0d0d;
        --lw-text:     #ffffff;
        --lw-btn-bg:   #d4a017;
        --lw-btn-text: #0d0d0d;
        max-width: 480px; margin: 0 auto;
      }
      .lw-signup { background: var(--lw-bg); border-radius: var(--lw-radius); padding: 36px 32px; color: var(--lw-text); position: relative; overflow: hidden; box-shadow: var(--lw-shadow); }
      .lw-signup::before { content:''; position:absolute; top:-60px; right:-60px; width:200px; height:200px; background:radial-gradient(circle, color-mix(in srgb, var(--lw-accent) 25%, transparent) 0%, transparent 70%); pointer-events:none; }
      .lw-signup-badge { display:inline-flex; align-items:center; gap:6px; background:color-mix(in srgb, var(--lw-accent) 15%, transparent); border:1px solid color-mix(in srgb, var(--lw-accent) 40%, transparent); border-radius:999px; padding:4px 12px; font-size:11px; font-weight:600; letter-spacing:0.08em; color:var(--lw-accent); text-transform:uppercase; margin-bottom:20px; }
      .lw-signup h2 { font-family:'DM Serif Display',serif; font-size:28px; line-height:1.2; margin:0 0 10px; font-weight:400; color:var(--lw-text); }
      .lw-signup h2 em { font-style:italic; color:var(--lw-accent); }
      .lw-signup p { font-size:14px; color:color-mix(in srgb, var(--lw-text) 60%, transparent); margin:0 0 28px; line-height:1.6; }
      .lw-perks { display:flex; gap:12px; margin-bottom:28px; flex-wrap:wrap; }
      .lw-perk { background:color-mix(in srgb, var(--lw-text) 6%, transparent); border:1px solid color-mix(in srgb, var(--lw-text) 10%, transparent); border-radius:10px; padding:10px 14px; font-size:12px; color:color-mix(in srgb, var(--lw-text) 80%, transparent); flex:1; min-width:100px; text-align:center; }
      .lw-perk-icon { font-size:20px; display:block; margin-bottom:4px; }
      .lw-btn { display:block; width:100%; padding:14px 24px; border-radius:calc(var(--lw-radius) - 6px); border:none; cursor:pointer; font-family:'DM Sans',sans-serif; font-size:15px; font-weight:600; letter-spacing:0.01em; transition:all 0.2s ease; text-align:center; }
      .lw-btn-primary { background:var(--lw-btn-bg); color:var(--lw-btn-text); }
      .lw-btn-primary:hover:not(:disabled) { opacity:0.88; transform:translateY(-1px); box-shadow:0 6px 20px rgba(0,0,0,0.2); }
      .lw-btn-primary:disabled { opacity:0.6; cursor:not-allowed; transform:none; }
      .lw-signup-note { margin-top:12px; font-size:11px; color:color-mix(in srgb, var(--lw-text) 35%, transparent); text-align:center; }

      .lw-dashboard { background:#fff; border-radius:var(--lw-radius); overflow:hidden; box-shadow:var(--lw-shadow); border:1px solid #e8e8e8; }
      .lw-hero { padding:28px 28px 24px; position:relative; overflow:hidden; }
      .lw-hero-top { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px; }
      .lw-greeting { font-size:13px; color:rgba(0,0,0,0.45); margin-bottom:2px; }
      .lw-name { font-family:'DM Serif Display',serif; font-size:22px; font-weight:400; color:#0d0d0d; }
      .lw-tier-badge { display:inline-flex; align-items:center; gap:5px; padding:5px 13px; border-radius:999px; font-size:12px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; }
      .lw-points-display { display:flex; align-items:baseline; gap:6px; margin-bottom:20px; }
      .lw-points-number { font-family:'DM Serif Display',serif; font-size:48px; line-height:1; color:#0d0d0d; }
      .lw-points-label { font-size:14px; color:rgba(0,0,0,0.5); font-weight:500; }
      .lw-progress-wrap { margin-bottom:4px; }
      .lw-progress-labels { display:flex; justify-content:space-between; font-size:11px; color:rgba(0,0,0,0.45); margin-bottom:6px; }
      .lw-progress-track { height:6px; background:rgba(0,0,0,0.08); border-radius:999px; overflow:hidden; }
      .lw-progress-fill { height:100%; border-radius:999px; transition:width 1s cubic-bezier(0.4,0,0.2,1); }
      .lw-progress-hint { font-size:11px; color:rgba(0,0,0,0.4); margin-top:5px; }
      .lw-progress-hint strong { color:#0d0d0d; }
      .lw-max-tier-msg { font-size:12px; font-weight:600; color:var(--lw-accent); margin-top:8px; }

      .lw-tabs { display:flex; border-bottom:1px solid #efefef; padding:0 28px; overflow-x:auto; }
      .lw-tab { padding:12px 14px; font-size:13px; font-weight:500; color:rgba(0,0,0,0.4); cursor:pointer; border:none; background:none; border-bottom:2px solid transparent; margin-bottom:-1px; transition:all 0.15s; font-family:'DM Sans',sans-serif; white-space:nowrap; }
      .lw-tab:hover { color:#0d0d0d; }
      .lw-tab.active { color:#0d0d0d; border-bottom-color:var(--lw-accent); }
      .lw-panel { display:none; padding:20px 28px 28px; }
      .lw-panel.active { display:block; }

      .lw-tx-list { list-style:none; margin:0; padding:0; }
      .lw-tx-item { display:flex; align-items:center; justify-content:space-between; padding:12px 0; border-bottom:1px solid #f0f0f0; gap:12px; }
      .lw-tx-item:last-child { border-bottom:none; }
      .lw-tx-icon { width:34px; height:34px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:14px; flex-shrink:0; }
      .lw-tx-meta { flex:1; min-width:0; }
      .lw-tx-desc { font-size:13px; font-weight:500; color:#0d0d0d; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .lw-tx-date { font-size:11px; color:rgba(0,0,0,0.4); margin-top:1px; }
      .lw-tx-pts { font-size:14px; font-weight:600; flex-shrink:0; }
      .lw-tx-pts.earn { color:#1a7a4a; }
      .lw-tx-pts.redeem { color:#b91c1c; }
      .lw-tx-pts.pending { color:#92400e; }
      .lw-tx-empty { text-align:center; padding:32px 0; color:rgba(0,0,0,0.35); font-size:13px; }

      /* ── Redeem tab ── */
      .lw-redeem-balance { background:#f9f9f9; border-radius:10px; padding:14px 16px; margin-bottom:20px; display:flex; justify-content:space-between; align-items:center; }
      .lw-redeem-balance-pts { font-size:22px; font-weight:700; color:#0d0d0d; }
      .lw-redeem-balance-label { font-size:12px; color:rgba(0,0,0,0.45); margin-top:2px; }
      .lw-presets { display:flex; flex-direction:column; gap:10px; margin-bottom:20px; }
      .lw-preset { display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border:1.5px solid #e8e8e8; border-radius:10px; cursor:pointer; transition:all 0.15s; background:#fff; width:100%; font-family:'DM Sans',sans-serif; }
      .lw-preset:hover { border-color:var(--lw-accent); background:color-mix(in srgb, var(--lw-accent) 4%, white); }
      .lw-preset.disabled { opacity:0.4; cursor:not-allowed; }
      .lw-preset-pts { font-size:15px; font-weight:600; color:#0d0d0d; }
      .lw-preset-val { font-size:13px; color:#1a7a4a; font-weight:600; }
      .lw-preset-arrow { color:rgba(0,0,0,0.25); font-size:16px; }
      .lw-redeem-loading { text-align:center; padding:20px; font-size:13px; color:rgba(0,0,0,0.45); }

      /* Active vouchers */
      .lw-vouchers-heading { font-size:12px; font-weight:600; color:#888; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:10px; }
      .lw-voucher { background:#0d0d0d; border-radius:10px; padding:14px 16px; margin-bottom:10px; display:flex; align-items:center; justify-content:space-between; gap:12px; }
      .lw-voucher-code { font-family:monospace; font-size:16px; font-weight:700; color:var(--lw-accent); letter-spacing:0.08em; }
      .lw-voucher-meta { font-size:11px; color:rgba(255,255,255,0.45); margin-top:2px; }
      .lw-voucher-amount { font-size:18px; font-weight:700; color:#fff; }
      .lw-copy-code-btn { background:var(--lw-btn-bg); color:var(--lw-btn-text); border:none; border-radius:6px; padding:6px 12px; font-size:12px; font-weight:600; cursor:pointer; font-family:'DM Sans',sans-serif; transition:all 0.15s; white-space:nowrap; }
      .lw-copy-code-btn:hover { opacity:0.88; }
      .lw-copy-code-btn.copied { background:#1a7a4a; color:#fff; }
      .lw-no-vouchers { text-align:center; padding:24px 0; color:rgba(0,0,0,0.35); font-size:13px; }

      /* Referral */
      .lw-referral-card { background:var(--lw-bg); border-radius:calc(var(--lw-radius) - 4px); padding:24px; color:var(--lw-text); position:relative; overflow:hidden; }
      .lw-referral-card::after { content:''; position:absolute; bottom:-40px; right:-40px; width:160px; height:160px; background:radial-gradient(circle, color-mix(in srgb, var(--lw-accent) 20%, transparent) 0%, transparent 70%); pointer-events:none; }
      .lw-referral-label { font-size:11px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:color-mix(in srgb, var(--lw-text) 50%, transparent); margin-bottom:8px; }
      .lw-referral-title { font-family:'DM Serif Display',serif; font-size:20px; font-weight:400; margin-bottom:6px; color:var(--lw-text); }
      .lw-referral-sub { font-size:13px; color:color-mix(in srgb, var(--lw-text) 55%, transparent); margin-bottom:20px; line-height:1.5; }
      .lw-referral-code-row { display:flex; gap:8px; align-items:stretch; }
      .lw-code-box { flex:1; background:color-mix(in srgb, var(--lw-text) 8%, transparent); border:1px solid color-mix(in srgb, var(--lw-text) 15%, transparent); border-radius:8px; padding:10px 14px; font-size:15px; font-weight:600; letter-spacing:0.1em; color:var(--lw-accent); font-family:monospace; }
      .lw-copy-btn { background:var(--lw-btn-bg); color:var(--lw-btn-text); border:none; border-radius:8px; padding:10px 16px; font-size:13px; font-weight:600; cursor:pointer; font-family:'DM Sans',sans-serif; transition:all 0.15s; white-space:nowrap; }
      .lw-copy-btn:hover { opacity:0.88; }
      .lw-copy-btn.copied { background:#1a7a4a; color:#fff; }

      .lw-loading { display:flex; align-items:center; justify-content:center; padding:48px; color:rgba(0,0,0,0.35); font-size:13px; gap:8px; }
      .lw-spinner { width:18px; height:18px; border:2px solid rgba(0,0,0,0.1); border-top-color:#0d0d0d; border-radius:50%; animation:lw-spin 0.7s linear infinite; }
      @keyframes lw-spin { to { transform:rotate(360deg); } }
      .lw-not-logged-in { text-align:center; padding:40px 24px; background:#f9f9f9; border-radius:var(--lw-radius); border:1px dashed #ddd; }
      .lw-not-logged-in p { font-size:14px; color:rgba(0,0,0,0.5); margin:8px 0 20px; }
      .lw-not-logged-in a { display:inline-block; background:var(--lw-bg); color:var(--lw-text); text-decoration:none; padding:10px 24px; border-radius:8px; font-size:14px; font-weight:600; transition:opacity 0.15s; }
      .lw-not-logged-in a:hover { opacity:0.8; }

      @media (max-width:480px) {
        .lw-signup { padding:28px 20px; }
        .lw-hero { padding:24px 20px 20px; }
        .lw-tabs { padding:0 16px; }
        .lw-panel { padding:16px 20px 24px; }
        .lw-points-number { font-size:40px; }
      }
    `;
    document.head.appendChild(style);
  }

  // ── Apply style from API ───────────────────────────────────────────────────
  async function applyStyle() {
    if (!APP_URL || !SHOP) return;
    try {
      const res = await fetch(`${APP_URL}/api/loyalty-style?shop=${encodeURIComponent(SHOP)}`);
      if (!res.ok) return;
      const s   = await res.json();
      const root = document.getElementById("loyalty-widget-root");
      if (!root) return;
      if (s.accentColor)          root.style.setProperty("--lw-accent",   s.accentColor);
      if (s.bgColor)              root.style.setProperty("--lw-bg",        s.bgColor);
      if (s.textColor)            root.style.setProperty("--lw-text",      s.textColor);
      if (s.buttonColor)          root.style.setProperty("--lw-btn-bg",    s.buttonColor);
      if (s.buttonTextColor)      root.style.setProperty("--lw-btn-text",  s.buttonTextColor);
      if (s.borderRadius != null) root.style.setProperty("--lw-radius",    `${s.borderRadius}px`);
    } catch(e) {}
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function formatDate(iso) {
    return new Date(iso).toLocaleDateString(undefined, { month:"short", day:"numeric", year:"numeric" });
  }
  function formatExpiry(iso) {
    return new Date(iso).toLocaleDateString(undefined, { month:"short", day:"numeric" });
  }
  function txIcon(type, status) {
    if (status === "pending")  return { emoji:"⏳", bg:"#fef3c7" };
    if (status === "voided" || status === "deducted") return { emoji:"↩️", bg:"#fee2e2" };
    if (type === "earn")   return { emoji:"⭐", bg:"#d1fae5" };
    if (type === "redeem") return { emoji:"🎟️", bg:"#ede9fe" };
    if (type === "adjust") return { emoji:"✏️", bg:"#e0e7ff" };
    return { emoji:"📋", bg:"#f3f4f6" };
  }
  function txPointsClass(type, status) {
    if (status === "pending") return "pending";
    if (status === "voided" || status === "deducted") return "redeem";
    return type === "earn" ? "earn" : type === "redeem" ? "redeem" : "";
  }
  function txPointsLabel(type, status, points) {
    if (status === "voided")   return `−${Math.abs(points)} (void)`;
    if (status === "deducted") return `−${Math.abs(points)}`;
    if (status === "pending")  return `+${points} (pending)`;
    if (type === "earn")       return `+${points}`;
    if (type === "redeem")     return `−${Math.abs(points)}`;
    return `${points > 0 ? "+" : ""}${points}`;
  }
  function txDesc(tx) {
    if (tx.note)      return tx.note;
    if (tx.orderName) return `Order ${tx.orderName}`;
    if (tx.type === "earn")   return "Points earned";
    if (tx.type === "redeem") return "Points redeemed";
    if (tx.type === "adjust") return "Manual adjustment";
    return "Transaction";
  }

  // ── Render: Not logged in ──────────────────────────────────────────────────
  function renderNotLoggedIn(container) {
    container.innerHTML = `
      <div class="lw-root">
        <div class="lw-not-logged-in">
          <div style="font-size:32px;margin-bottom:8px;">🔒</div>
          <p>Log in to join our loyalty program and start earning rewards.</p>
          <a href="/account/login">Log in to your account</a>
        </div>
      </div>`;
  }

  // ── Render: Signup ─────────────────────────────────────────────────────────
 // ── Render: Signup ─────────────────────────────────────────────────────────
function renderSignup(container, onEnrolled) {
  const refCode = new URLSearchParams(window.location.search).get("ref") || "";

  container.innerHTML = `
    <div class="lw-root">
      <div class="lw-signup">
        <div class="lw-signup-badge">✦ New — Loyalty Program</div>
        <h2>Earn rewards on<br><em>every purchase</em></h2>
        <p>Join thousands of members earning points, unlocking tiers, and getting exclusive perks.</p>
        <div class="lw-perks">
          <div class="lw-perk"><span class="lw-perk-icon">⭐</span>Earn points</div>
          <div class="lw-perk"><span class="lw-perk-icon">🎯</span>Unlock tiers</div>
          <div class="lw-perk"><span class="lw-perk-icon">🎁</span>Get rewards</div>
        </div>
        <div style="margin-bottom:20px;">
          <label style="display:block;font-size:12px;font-weight:600;color:color-mix(in srgb,var(--lw-text) 55%,transparent);margin-bottom:8px;letter-spacing:0.05em;text-transform:uppercase;">
            Referral Code <span style="font-weight:400;opacity:0.6;">(optional)</span>
          </label>
          <input
            id="lw-referral-input"
            type="text"
            placeholder="Enter referral code"
            value="${refCode}"
            style="
              width:100%;box-sizing:border-box;
              background:color-mix(in srgb,var(--lw-text) 8%,transparent);
              border:1px solid color-mix(in srgb,var(--lw-text) 18%,transparent);
              border-radius:10px;padding:12px 14px;
              font-size:14px;font-family:'DM Sans',sans-serif;
              color:var(--lw-text);outline:none;
              transition:border-color 0.15s;
            "
          />
        </div>
        <button class="lw-btn lw-btn-primary" id="lw-join-btn">Join for free</button>
        <p class="lw-signup-note">No credit card needed. Instant enrollment.</p>
      </div>
    </div>`;

  // Focus style on input
  const input = document.getElementById("lw-referral-input");
  input.addEventListener("focus", function () {
    this.style.borderColor = "var(--lw-accent)";
  });
  input.addEventListener("blur", function () {
    this.style.borderColor = "color-mix(in srgb,var(--lw-text) 18%,transparent)";
  });

  document.getElementById("lw-join-btn").addEventListener("click", async function () {
    const btn = this;
    const referralCode = document.getElementById("lw-referral-input").value.trim() || null;

    btn.disabled = true; btn.textContent = "Joining...";
    try {
      const res = await fetch(`${APP_URL}/api/loyalty-signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop:         SHOP,
          customerId:   CUSTOMER_ID,
          email:        window.__LOYALTY_CUSTOMER_EMAIL__      || null,
          firstName:    window.__LOYALTY_CUSTOMER_FIRST_NAME__ || null,
          lastName:     window.__LOYALTY_CUSTOMER_LAST_NAME__  || null,
          referralCode: referralCode,
        }),
      });
      const data = await res.json();
      if (data.success) { onEnrolled(); }
      else { btn.disabled = false; btn.textContent = "Try again"; }
    } catch(e) { btn.disabled = false; btn.textContent = "Try again"; }
  });
}

  // ── Render: Dashboard ─────────────────────────────────────────────────────
  function renderDashboard(container, data) {
    const { customer, tierProgress, transactions, vouchers = [], redemptionPresets = [] } = data;
    const referral     = data.referral || {};
    const referralCode = referral.code || '';
    const tier = customer.tier || "bronze";
    const hero = TIER_HERO[tier] || TIER_HERO.bronze;
    const icon = TIER_ICONS[tier] || "🥉";
    const name = customer.firstName || "Member";

    const progressBar = tierProgress.nextTier ? `
      <div class="lw-progress-wrap">
        <div class="lw-progress-labels">
          <span>${icon} ${tier.charAt(0).toUpperCase() + tier.slice(1)}</span>
          <span>${TIER_ICONS[tierProgress.nextTier]} ${tierProgress.nextTier.charAt(0).toUpperCase() + tierProgress.nextTier.slice(1)}</span>
        </div>
        <div class="lw-progress-track">
          <div class="lw-progress-fill" style="width:${tierProgress.progressPercent}%;background:${hero.accent}"></div>
        </div>
        <div class="lw-progress-hint"><strong>${tierProgress.pointsToNext.toLocaleString()} pts</strong> to reach ${tierProgress.nextTier}</div>
      </div>` : `<div class="lw-max-tier-msg">🏆 You've reached our highest tier!</div>`;

    const txRows = transactions.length
      ? transactions.map((tx) => {
          const { emoji, bg } = txIcon(tx.type, tx.status);
          return `<li class="lw-tx-item">
            <div class="lw-tx-icon" style="background:${bg}">${emoji}</div>
            <div class="lw-tx-meta">
              <div class="lw-tx-desc">${txDesc(tx)}</div>
              <div class="lw-tx-date">${formatDate(tx.createdAt)}</div>
            </div>
            <div class="lw-tx-pts ${txPointsClass(tx.type, tx.status)}">${txPointsLabel(tx.type, tx.status, tx.points)}</div>
          </li>`;
        }).join("")
      : `<div class="lw-tx-empty">No transactions yet. Start shopping to earn points!</div>`;

    // Redeem tab
    const presets = redemptionPresets;
    const currentPoints = customer.points;

    const presetRows = presets.map((p) => {
      const canAfford = p.canAfford !== undefined ? p.canAfford : currentPoints >= p.points;
      return `<button class="lw-preset ${canAfford ? "" : "disabled"}" data-points="${p.points}" ${canAfford ? "" : "disabled"}>
        <div>
          <div class="lw-preset-pts">${p.points.toLocaleString()} pts</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="lw-preset-val">$${(p.value || p.discountAmount || 0).toFixed(2)} off</span>
          <span class="lw-preset-arrow">→</span>
        </div>
      </button>`;
    }).join("");

    const voucherRows = vouchers.length
      ? vouchers.map((v) => `
        <div class="lw-voucher">
          <div>
            <div class="lw-voucher-code">${v.code}</div>
            <div class="lw-voucher-meta">Expires ${formatExpiry(v.expiresAt)} · ${v.pointsUsed || v.pointsRedeemed || 0} pts redeemed</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="lw-voucher-amount">$${v.discountAmount.toFixed(2)}</div>
            <button class="lw-copy-code-btn" data-code="${v.code}">Copy</button>
          </div>
        </div>`).join("")
      : "";

    container.innerHTML = `
      <div class="lw-root">
        <div class="lw-dashboard">
          <div class="lw-hero" style="background:${hero.bg}">
            <div class="lw-hero-top">
              <div>
                <div class="lw-greeting">Welcome back,</div>
                <div class="lw-name">${name}</div>
              </div>
              <div class="lw-tier-badge" style="background:${hero.accent};color:${hero.bg}">${icon} ${tier}</div>
            </div>
            <div class="lw-points-display">
              <div class="lw-points-number" id="lw-pts-display">${currentPoints.toLocaleString()}</div>
              <div class="lw-points-label">points available</div>
            </div>
            ${progressBar}
          </div>

          <div class="lw-tabs">
            <button class="lw-tab active" data-panel="redeem">Redeem</button>
            <button class="lw-tab" data-panel="history">History</button>
            <button class="lw-tab" data-panel="referral">Refer a Friend</button>
          </div>

          <div class="lw-panel active" id="lw-panel-redeem">
            <div class="lw-redeem-balance">
              <div>
                <div class="lw-redeem-balance-pts" id="lw-redeem-pts">${currentPoints.toLocaleString()}</div>
                <div class="lw-redeem-balance-label">points available to redeem</div>
              </div>
              <div style="font-size:12px;color:rgba(0,0,0,0.4);text-align:right;">
                ${tier === "gold" ? "🥇 Gold rate" : tier === "silver" ? "🥈 Silver rate" : "🥉 Bronze rate"}
              </div>
            </div>
            <div class="lw-presets" id="lw-presets">
              ${presetRows.length ? presetRows : '<div class="lw-tx-empty">No redemption options available.</div>'}
            </div>
            ${vouchers.length ? `<div class="lw-vouchers-heading">Your active vouchers</div>${voucherRows}` : ""}
          </div>

          <div class="lw-panel" id="lw-panel-history">
            <ul class="lw-tx-list">${txRows}</ul>
          </div>

          <div class="lw-panel" id="lw-panel-referral">
            <div class="lw-referral-card">
              <div class="lw-referral-label">Refer & Earn</div>
              <div class="lw-referral-title">Share your code,<br>both of you win</div>
              <div class="lw-referral-sub">
                ${referral.signupBonus ? `Your friend gets <strong style="color:var(--lw-accent)">${referral.signupBonus} pts</strong> on signup. ` : ''}
                ${referral.referrerPct ? `You both earn <strong style="color:var(--lw-accent)">${referral.referrerPct}%</strong> bonus on their first order.` : ''}
              </div>
              ${referral.totalReferrals != null ? `
              <div style="display:flex;gap:16px;margin-bottom:18px;">
                <div style="text-align:center;">
                  <div style="font-size:22px;font-weight:700;color:var(--lw-accent)">${referral.totalReferrals}</div>
                  <div style="font-size:11px;color:color-mix(in srgb,var(--lw-text) 50%,transparent)">Referred</div>
                </div>
                <div style="text-align:center;">
                  <div style="font-size:22px;font-weight:700;color:var(--lw-accent)">${referral.completedReferrals || 0}</div>
                  <div style="font-size:11px;color:color-mix(in srgb,var(--lw-text) 50%,transparent)">Completed</div>
                </div>
              </div>` : ''}
              <div class="lw-referral-code-row">
                <div class="lw-code-box">${referralCode}</div>
                <button class="lw-copy-btn" id="lw-copy-referral">Copy</button>
              </div>
              <button class="lw-copy-btn" id="lw-share-btn" style="margin-top:8px;width:100%;border-radius:8px;padding:10px;">
                🔗 Copy share link
              </button>
            </div>
          </div>
        </div>
      </div>`;

    // Tab switching
    container.querySelectorAll(".lw-tab").forEach((tab) => {
      tab.addEventListener("click", function () {
        container.querySelectorAll(".lw-tab").forEach((t) => t.classList.remove("active"));
        container.querySelectorAll(".lw-panel").forEach((p) => p.classList.remove("active"));
        this.classList.add("active");
        document.getElementById(`lw-panel-${this.dataset.panel}`).classList.add("active");
      });
    });

    // Copy referral
    document.getElementById("lw-copy-referral")?.addEventListener("click", function () {
      navigator.clipboard.writeText(referralCode).then(() => {
        this.textContent = "Copied!"; this.classList.add("copied");
        setTimeout(() => { this.textContent = "Copy"; this.classList.remove("copied"); }, 2000);
      });
    });
    document.getElementById("lw-share-btn")?.addEventListener("click", function () {
      const shareUrl = `${window.location.origin}/pages/loyalty-rewards?ref=${encodeURIComponent(referralCode)}`;
      navigator.clipboard.writeText(shareUrl).then(() => {
        this.textContent = "✓ Link copied!"; this.classList.add("copied");
        setTimeout(() => { this.textContent = "🔗 Copy share link"; this.classList.remove("copied"); }, 2000);
      });
    });

    // Copy voucher codes
    container.querySelectorAll(".lw-copy-code-btn").forEach((btn) => {
      btn.addEventListener("click", function () {
        navigator.clipboard.writeText(this.dataset.code).then(() => {
          this.textContent = "Copied!"; this.classList.add("copied");
          setTimeout(() => { this.textContent = "Copy"; this.classList.remove("copied"); }, 2000);
        });
      });
    });

    // Preset redemption buttons
    let redeeming = false;
    container.querySelectorAll(".lw-preset:not(.disabled)").forEach((btn) => {
      btn.addEventListener("click", async function () {
        if (redeeming) return;
        const pts = Number(this.dataset.points);

        redeeming = true;
        const presetsEl = document.getElementById("lw-presets");
        presetsEl.innerHTML = `<div class="lw-redeem-loading"><div style="display:flex;align-items:center;justify-content:center;gap:8px;"><div class="lw-spinner"></div> Generating your discount code…</div></div>`;

        try {
          const res  = await fetch(`${APP_URL}/api/loyalty-redeem`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ shop: SHOP, customerId: CUSTOMER_ID, pointsToRedeem: pts }),
          });
          const result = await res.json();

          if (result.success) {
            // Update points display
            const newBalance = result.newBalance;
            const ptsDisplay = document.getElementById("lw-pts-display");
            const redeemPts  = document.getElementById("lw-redeem-pts");
            if (ptsDisplay) ptsDisplay.textContent = newBalance.toLocaleString();
            if (redeemPts)  redeemPts.textContent  = newBalance.toLocaleString();

            // Show the new voucher
            presetsEl.innerHTML = `
              <div style="text-align:center;padding:16px 0 20px;">
                <div style="font-size:28px;margin-bottom:8px;">🎉</div>
                <div style="font-size:15px;font-weight:600;color:#0d0d0d;margin-bottom:4px;">Discount code ready!</div>
                <div style="font-size:13px;color:rgba(0,0,0,0.45);margin-bottom:16px;">Valid for 30 days · One-time use</div>
              </div>
              <div class="lw-voucher">
                <div>
                  <div class="lw-voucher-code">${result.code}</div>
                  <div class="lw-voucher-meta">Expires ${formatExpiry(result.expiresAt)} · ${pts} pts redeemed</div>
                </div>
                <div style="display:flex;align-items:center;gap:10px;">
                  <div class="lw-voucher-amount">$${result.discountAmount.toFixed(2)}</div>
                  <button class="lw-copy-code-btn" data-code="${result.code}">Copy</button>
                </div>
              </div>
              <button class="lw-btn" style="background:#f3f4f6;color:#0d0d0d;margin-top:12px;" id="lw-redeem-again">Redeem more points</button>
            `;

            // Wire copy on new voucher
            presetsEl.querySelector(".lw-copy-code-btn")?.addEventListener("click", function () {
              navigator.clipboard.writeText(this.dataset.code).then(() => {
                this.textContent = "Copied!"; this.classList.add("copied");
                setTimeout(() => { this.textContent = "Copy"; this.classList.remove("copied"); }, 2000);
              });
            });

            // Redeem again — re-init
            document.getElementById("lw-redeem-again")?.addEventListener("click", () => init());
          } else {
            presetsEl.innerHTML = `<div class="lw-tx-empty">⚠ ${result.error || "Something went wrong. Please try again."}</div>`;
            setTimeout(() => init(), 2000);
          }
        } catch(e) {
          presetsEl.innerHTML = `<div class="lw-tx-empty">⚠ Network error. Please try again.</div>`;
          setTimeout(() => init(), 2000);
        } finally {
          redeeming = false;
        }
      });
    });
  }

  // ── Main init ──────────────────────────────────────────────────────────────
  async function init() {
    const container = document.getElementById("loyalty-widget-root");
    if (!container) return;

    injectStyles();
    await applyStyle();

    if (!CUSTOMER_ID) { renderNotLoggedIn(container); return; }

    container.innerHTML = `<div class="lw-root"><div class="lw-loading"><div class="lw-spinner"></div> Loading your rewards…</div></div>`;

    try {
      const res  = await fetch(`${APP_URL}/api/loyalty-dashboard?shop=${encodeURIComponent(SHOP)}&customerId=${encodeURIComponent(CUSTOMER_ID)}`);
      const data = await res.json();
      if (!data.enrolled) { renderSignup(container, () => init()); }
      else { renderDashboard(container, data); }
    } catch(e) {
      console.error("[loyalty-widget] init error", e);
      container.innerHTML = `<div class="lw-root"><div class="lw-loading">Something went wrong. Please refresh.</div></div>`;
    }
  }

  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", init); }
  else { init(); }
})();