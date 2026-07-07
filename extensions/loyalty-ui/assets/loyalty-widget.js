(function () {
  "use strict";

  const _root = document.getElementById("loyalty-widget-root");
  const APP_URL = window.__LOYALTY_APP_URL__ || (_root && _root.dataset.appUrl) || "";
  const SHOP = window.__LOYALTY_SHOP__ || (Shopify && Shopify.shop) || "";
  const CUSTOMER_ID = window.__LOYALTY_CUSTOMER_ID__ || null;
  // read referral code from ?ref= URL param once on load
  const REF_CODE = new URLSearchParams(window.location.search).get("ref") || null;

  const TIER_ORDER = ["bronze", "silver", "gold"];

  // ── Icons (inline SVG, currentColor so they inherit theme colors) ──────────
  function svgIcon(name, size) {
    const s = size || 16;
    const tpl = ICONS[name];
    if (!tpl) return "";
    return tpl.replace(/\{\{SIZE\}\}/g, s);
  }

  const ICONS = {
    lock: `<svg width="{{SIZE}}" height="{{SIZE}}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>`,

    star: `<svg width="{{SIZE}}" height="{{SIZE}}" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2.5l2.9 6.6 7.1.7-5.4 4.8 1.6 7-6.2-3.9-6.2 3.9 1.6-7-5.4-4.8 7.1-.7z"></path></svg>`,

    target: `<svg width="{{SIZE}}" height="{{SIZE}}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="5.2"></circle><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"></circle></svg>`,

    gift: `<svg width="{{SIZE}}" height="{{SIZE}}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="9" width="18" height="4" rx="1"></rect><rect x="4.5" y="13" width="15" height="8" rx="1"></rect><path d="M12 9v12"></path><path d="M12 9c-1.3-3-3-4.5-4.6-4.5A2 2 0 0 0 5.5 6.6C5.5 8.4 7.6 9 12 9z"></path><path d="M12 9c1.3-3 3-4.5 4.6-4.5A2 2 0 0 1 18.5 6.6C18.5 8.4 16.4 9 12 9z"></path></svg>`,

    ticket: `<svg width="{{SIZE}}" height="{{SIZE}}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h15A1.5 1.5 0 0 1 21 8.5v2a2 2 0 0 0 0 3v2a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15.5v-2a2 2 0 0 0 0-3z"></path><path d="M10 7v10" stroke-dasharray="2 2"></path></svg>`,

    edit: `<svg width="{{SIZE}}" height="{{SIZE}}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg>`,

    clipboard: `<svg width="{{SIZE}}" height="{{SIZE}}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"></rect><rect x="9" y="2.5" width="6" height="3" rx="1"></rect><path d="M9 11h6M9 15h6"></path></svg>`,

    clock: `<svg width="{{SIZE}}" height="{{SIZE}}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3.5 2"></path></svg>`,

    undo: `<svg width="{{SIZE}}" height="{{SIZE}}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h9a5 5 0 0 1 0 10h-2"></path><path d="M8 5.5 4 10l4 4.5"></path></svg>`,

    award: `<svg width="{{SIZE}}" height="{{SIZE}}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="5.5"></circle><path d="M9 13.5 7.5 21l4.5-2.3 4.5 2.3-1.5-7.5"></path></svg>`,

    checkCircle: `<svg width="{{SIZE}}" height="{{SIZE}}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M8 12.5l2.5 2.5 5.5-6"></path></svg>`,

    link: `<svg width="{{SIZE}}" height="{{SIZE}}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 14.5l5-5"></path><path d="M13 7.5l1.4-1.4a3.5 3.5 0 0 1 5 5L18 12.5"></path><path d="M11 16.5l-1.4 1.4a3.5 3.5 0 0 1-5-5L6 11.5"></path></svg>`,

    alertTriangle: `<svg width="{{SIZE}}" height="{{SIZE}}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 22 20.5H2z"></path><path d="M12 9.5v5"></path><circle cx="12" cy="17.3" r="0.9" fill="currentColor" stroke="none"></circle></svg>`,
  };

  // ── Styles ──────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById("loyalty-widget-styles")) return;
    const style = document.createElement("style");
    style.id = "loyalty-widget-styles";
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap');
#loyalty-widget-root {
    --lw-radius:16px;
    --lw-accent:#d4a017;
    --lw-bg:#0d0d0d;
    --lw-text:#fff;
    --lw-btn-bg:#d4a017;
    --lw-btn-text:#0d0d0d;
}

      .lw-root {
        /* ── Merchant-configurable, set live from /api/loyalty-style via applyStyle() ── */
        // --lw-radius:    16px;
        // --lw-accent:    #d4a017;
        // --lw-bg:        #0d0d0d;
        // --lw-text:      #ffffff;
        // --lw-btn-bg:    #d4a017;
        // --lw-btn-text:  #0d0d0d;

        /* ── Derived automatically from the merchant colors above (no fixed hexes) ── */
        --lw-accent-dark: color-mix(in srgb, var(--lw-accent) 65%, black 35%);
        --lw-accent-soft: color-mix(in srgb, var(--lw-accent) 14%, white 86%);
        --lw-bg-2:         color-mix(in srgb, var(--lw-bg) 88%, white 12%);
        --lw-bg-soft:      color-mix(in srgb, var(--lw-bg) 10%, white 90%);
        --lw-text-soft:    color-mix(in srgb, var(--lw-text) 55%, transparent);
        --lw-text-faint:   color-mix(in srgb, var(--lw-text) 35%, transparent);

        /* ── Fixed neutrals used only for body text on white cards ── */
        --lw-shadow:    0 10px 30px rgba(13,31,28,0.06);
        --lw-ink:       #0d0d0d;
        --lw-muted:     rgba(0,0,0,0.5);
        --lw-muted-2:   rgba(0,0,0,0.36);
        --lw-line:      rgba(0,0,0,0.08);

        --lw-radius-lg: var(--lw-radius);
        --lw-radius-md: calc(var(--lw-radius) * 0.85);
        --lw-radius-sm: calc(var(--lw-radius) * 0.6);

        width: 100%; max-width: 1400px; margin: 0 auto;
        font-family: 'Inter', sans-serif; color: var(--lw-ink);
        -webkit-font-smoothing: antialiased;
      }
      .lw-root *{ box-sizing: border-box; }
      .lw-root svg { display:block; flex-shrink:0; }

      .lw-eyebrow { display:inline-flex; align-items:center; gap:8px; font-size:11.5px; font-weight:600; letter-spacing:0.12em; text-transform:uppercase; color:var(--lw-accent-dark); margin:0 0 10px; }
      .lw-eyebrow::before { content:''; width:6px; height:6px; border-radius:50%; background:var(--lw-accent); }
      .lw-heading { font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:32px; line-height:1.1; margin:0 0 6px; letter-spacing:-0.01em; color:var(--lw-ink); }
      .lw-subheading { font-size:14.5px; color:var(--lw-muted); margin:0 0 26px; max-width:560px; }

      /* ── Hero row ── */
      .lw-hero-grid { display:grid; grid-template-columns:1.15fr 0.85fr; gap:20px; margin-bottom:20px; }
      .lw-hero-card {
        position:relative; overflow:hidden; border-radius:var(--lw-radius-lg);
        background: radial-gradient(140% 140% at 15% 15%, var(--lw-accent) 0%, var(--lw-accent-dark) 70%);
        padding:32px 34px; color:var(--lw-text); min-height:270px; display:flex; flex-direction:column; justify-content:space-between;
      }
      .lw-hero-card::after { content:''; position:absolute; inset:0; background:radial-gradient(60% 90% at 100% 0%, color-mix(in srgb, var(--lw-text) 28%, transparent), transparent 60%); mix-blend-mode:overlay; pointer-events:none; }
      .lw-hero-top { display:flex; justify-content:space-between; align-items:flex-start; position:relative; z-index:1; }
      .lw-hero-greeting { font-size:13px; opacity:0.85; margin-bottom:4px; }
      .lw-hero-tier { font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:28px; text-transform:capitalize; }
      .lw-hero-icon { width:44px; height:44px; border-radius:50%; border:2px solid color-mix(in srgb, var(--lw-text) 70%, transparent); background:color-mix(in srgb, var(--lw-text) 22%, transparent); display:flex; align-items:center; justify-content:center; font-size:19px; }
      .lw-hero-progress { position:relative; z-index:1; }
      .lw-hero-progress-row { display:flex; justify-content:space-between; align-items:baseline; font-family:'JetBrains Mono',monospace; font-size:13px; margin-bottom:10px; }
      .lw-hero-progress-row .lw-pts-now { font-size:26px; font-weight:600; }
      .lw-track { height:8px; border-radius:999px; background:color-mix(in srgb, var(--lw-text) 28%, transparent); overflow:hidden; }
      .lw-track-fill { height:100%; border-radius:999px; background:var(--lw-text); transition:width 1s cubic-bezier(.4,0,.2,1); }
      .lw-hero-hint { margin-top:10px; font-size:12.5px; opacity:0.9; display:flex; align-items:center; gap:6px; }

      .lw-panel { background:var(--lw-bg); border-radius:var(--lw-radius-lg); padding:24px 26px; color:var(--lw-text); display:flex; flex-direction:column; gap:14px; }
      .lw-panel-heading { font-family:'Space Grotesk',sans-serif; font-size:16px; font-weight:600; }
      .lw-panel-row { display:flex; align-items:center; justify-content:space-between; background:var(--lw-bg-2); border:1px solid color-mix(in srgb, var(--lw-text) 8%, transparent); border-radius:var(--lw-radius-md); padding:14px 16px; gap:10px; }
      .lw-panel-row-value { font-family:'Space Grotesk',sans-serif; font-size:19px; font-weight:700; }
      .lw-panel-row-label { font-size:11px; color:color-mix(in srgb, var(--lw-text) 50%, transparent); text-transform:uppercase; letter-spacing:0.07em; margin-top:2px; }
      .lw-code-chip-sm { font-family:'JetBrains Mono',monospace; font-size:12.5px; font-weight:700; letter-spacing:0.05em; color:var(--lw-accent); }
      .lw-btn-pill { border:none; border-radius:999px; padding:9px 16px; font-size:12.5px; font-weight:700; background:var(--lw-btn-bg); color:var(--lw-btn-text); cursor:pointer; font-family:'Inter',sans-serif; transition:transform .15s ease, opacity .15s ease; white-space:nowrap; }
      .lw-btn-pill:hover { transform:translateY(-1px); opacity:0.92; }
      .lw-panel-empty { font-size:12.5px; color:color-mix(in srgb, var(--lw-text) 50%, transparent); text-align:center; padding:10px 0; }

      /* ── Tier stepper row ── */
      .lw-tier-row { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-bottom:20px; }
      .lw-tier-card { background:#fff; border:1.5px solid var(--lw-line); border-radius:var(--lw-radius-md); padding:18px 18px 16px; box-shadow:var(--lw-shadow); }
      .lw-tier-card.current { background:var(--lw-bg); border-color:var(--lw-bg); color:var(--lw-text); }
      .lw-tier-card.completed { opacity:0.65; }
      .lw-tier-card-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
      .lw-tier-card-name { font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:15px; display:flex; align-items:center; gap:8px; }
      .lw-tier-card-status { font-size:11.5px; color:var(--lw-muted); }
      .lw-tier-card.current .lw-tier-card-status { color:color-mix(in srgb, var(--lw-text) 65%, transparent); }
      .lw-tier-badge-sm { font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; padding:3px 8px; border-radius:999px; background:var(--lw-accent-soft); color:var(--lw-accent-dark); }
      .lw-tier-badge-sm.current { background:color-mix(in srgb, var(--lw-text) 16%, transparent); color:var(--lw-text); }
      .lw-tier-mini-track { height:5px; border-radius:999px; background:var(--lw-line); margin-top:12px; overflow:hidden; }
      .lw-tier-card.current .lw-tier-mini-track { background:color-mix(in srgb, var(--lw-text) 16%, transparent); }
      .lw-tier-mini-fill { height:100%; border-radius:999px; background:var(--lw-accent); }
      .lw-tier-card.current .lw-tier-mini-fill { background:var(--lw-text); }

      /* ── Lower grid ── */
      .lw-lower-grid { display:grid; grid-template-columns:1.3fr 1fr; gap:20px; align-items:start; }
      .lw-lower { display:grid; grid-template-columns:1fr; gap:20px; align-items:start;     margin-top: 20px;}
      .lw-card { background:#fff; border:1.5px solid var(--lw-line); border-radius:var(--lw-radius-lg); box-shadow:var(--lw-shadow); padding:24px 26px; }
      .lw-card + .lw-card { margin-top:20px; }
      .lw-card-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; }
      .lw-card-title { font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:16px; }

      /* Transactions */
      .lw-tx-list { list-style:none; margin:0; padding:0; max-height:520px; overflow-y:auto; }
      .lw-tx-item { display:flex; align-items:center; justify-content:space-between; padding:12px 0; border-bottom:1px solid var(--lw-line); gap:10px; }
      .lw-tx-item:last-child { border-bottom:none; }
      .lw-tx-icon { width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
      .lw-tx-meta { flex:1; min-width:0; }
      .lw-tx-desc { font-size:13.5px; font-weight:600; color:var(--lw-ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .lw-tx-date { font-size:11.5px; color:var(--lw-muted-2); margin-top:1px; font-family:'JetBrains Mono',monospace; }
      .lw-tx-type-pill { font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; padding:3px 9px; border-radius:999px; background:var(--lw-line); color:var(--lw-muted); flex-shrink:0; white-space:nowrap; }
      .lw-tx-type-pill.earn { background:var(--lw-accent-soft); color:var(--lw-accent-dark); }
      .lw-tx-type-pill.redeem { background:var(--lw-bg-soft); color:var(--lw-bg); }
      .lw-tx-type-pill.pending { background:#fef3c7; color:#92400e; }
      .lw-tx-pts { font-size:14px; font-weight:700; flex-shrink:0; font-family:'JetBrains Mono',monospace; }
      .lw-tx-pts.earn { color:var(--lw-accent-dark); }
      .lw-tx-pts.redeem { color:var(--lw-bg); }
      .lw-tx-pts.pending { color:#92400e; }
      .lw-tx-empty { text-align:center; padding:32px 0; color:var(--lw-muted-2); font-size:13px; }

      /* Redeem */
      .lw-redeem-balance { background:var(--lw-bg); border-radius:var(--lw-radius-md); padding:16px 20px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center; gap:12px; }
      .lw-redeem-balance-pts { font-family:'Space Grotesk',sans-serif; font-size:21px; font-weight:700; color:var(--lw-text); }
      .lw-redeem-balance-label { font-size:11px; color:color-mix(in srgb, var(--lw-text) 55%, transparent); margin-top:2px; text-transform:uppercase; letter-spacing:0.06em; }
      .lw-redeem-rate-pill { font-size:11px; font-weight:700; background:var(--lw-btn-bg); color:var(--lw-btn-text); padding:7px 14px; border-radius:999px; white-space:nowrap; display:inline-flex; align-items:center; gap:6px; }
      .lw-presets { display:flex; flex-direction:column; gap:10px; margin-bottom:16px; }
      .lw-preset { display:flex; align-items:center; justify-content:space-between; padding:13px 16px; border:1.5px solid var(--lw-line); border-radius:var(--lw-radius-sm); cursor:pointer; transition:all 0.15s; background:#fff; width:100%; font-family:'Inter',sans-serif; }
      .lw-preset:hover:not(.disabled) { border-color:var(--lw-accent); background:color-mix(in srgb, var(--lw-accent) 4%, white); }
      .lw-preset.disabled { opacity:0.4; cursor:not-allowed; }
      .lw-preset-pts { font-size:14px; font-weight:600; color:var(--lw-ink); }
      .lw-preset-val { font-size:12.5px; color:var(--lw-accent-dark); font-weight:700; }
      .lw-preset-arrow { color:rgba(0,0,0,0.25); font-size:15px; margin-left:8px; }
      .lw-redeem-loading { text-align:center; padding:20px; font-size:13px; color:var(--lw-muted); }
      .lw-spinner { width:18px; height:18px; border:2px solid rgba(0,0,0,0.1); border-top-color:var(--lw-ink); border-radius:50%; animation:lw-spin 0.7s linear infinite; display:inline-block; vertical-align:middle; }
      @keyframes lw-spin { to { transform:rotate(360deg); } }

      .lw-custom-redeem { margin-top:6px; border-top:1px solid var(--lw-line); padding-top:14px; }
      .lw-custom-redeem-label { font-size:11.5px; font-weight:600; color:var(--lw-muted-2); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:8px; }
      .lw-custom-redeem-row { display:flex; gap:8px; align-items:center; }
      .lw-custom-input { flex:1; padding:11px 13px; border:1.5px solid var(--lw-line); border-radius:var(--lw-radius-sm); font-size:13.5px; font-family:'Inter',sans-serif; outline:none; transition:border-color 0.15s; }
      .lw-custom-input:focus { border-color:var(--lw-accent); }
      .lw-custom-input.error { border-color:#b91c1c; }
      .lw-custom-submit { padding:11px 18px; border-radius:var(--lw-radius-sm); border:none; background:var(--lw-btn-bg); color:var(--lw-btn-text); font-size:13px; font-weight:700; cursor:pointer; font-family:'Inter',sans-serif; white-space:nowrap; transition:opacity 0.15s; }
      .lw-custom-submit:hover { opacity:0.88; }
      .lw-custom-hint { font-size:11px; color:var(--lw-muted-2); margin-top:6px; display:flex; align-items:center; gap:5px; }
      .lw-custom-hint.err { color:#b91c1c; }

      /* Vouchers */
      .lw-vouchers-heading { font-size:11.5px; font-weight:600; color:var(--lw-muted-2); text-transform:uppercase; letter-spacing:0.06em; margin:18px 0 10px; }
      .lw-voucher { background:var(--lw-bg); border-radius:var(--lw-radius-sm); padding:14px 16px; margin-bottom:10px; display:flex; align-items:center; justify-content:space-between; gap:12px; }
      .lw-voucher-code { font-family:'JetBrains Mono',monospace; font-size:15px; font-weight:700; color:var(--lw-accent); letter-spacing:0.06em; }
      .lw-voucher-meta { font-size:11px; color:color-mix(in srgb, var(--lw-text) 45%, transparent); margin-top:2px; }
      .lw-voucher-amount { font-size:17px; font-weight:700; color:var(--lw-text); font-family:'Space Grotesk',sans-serif; }
      .lw-copy-code-btn { background:var(--lw-btn-bg); color:var(--lw-btn-text); border:none; border-radius:8px; padding:7px 12px; font-size:11.5px; font-weight:700; cursor:pointer; font-family:'Inter',sans-serif; transition:all 0.15s; white-space:nowrap; }
      .lw-copy-code-btn:hover { opacity:0.88; }
      .lw-copy-code-btn.copied { background:var(--lw-accent-dark); color:var(--lw-text); }

      /* Referral card */
      .lw-referral-card { background:var(--lw-bg); border-radius:var(--lw-radius-lg); padding:24px 26px; color:var(--lw-text); position:relative; overflow:hidden; }
      .lw-referral-card::after { content:''; position:absolute; bottom:-40px; right:-40px; width:160px; height:160px; background:radial-gradient(circle, color-mix(in srgb, var(--lw-accent) 25%, transparent) 0%, transparent 70%); pointer-events:none; }
      .lw-referral-label { font-size:11px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:color-mix(in srgb, var(--lw-text) 50%, transparent); margin-bottom:8px; position:relative; z-index:1; }
      .lw-referral-title { font-family:'Space Grotesk',sans-serif; font-size:19px; font-weight:600; margin-bottom:6px; position:relative; z-index:1; }
      .lw-referral-sub { font-size:12.5px; color:color-mix(in srgb, var(--lw-text) 60%, transparent); margin-bottom:18px; line-height:1.5; position:relative; z-index:1; }
      .lw-referral-stats { display:flex; gap:16px; margin-bottom:16px; position:relative; z-index:1; }
      .lw-referral-stat-num { font-family:'Space Grotesk',sans-serif; font-size:20px; font-weight:700; color:var(--lw-accent); }
      .lw-referral-stat-label { font-size:10.5px; color:color-mix(in srgb, var(--lw-text) 50%, transparent); }
      .lw-referral-code-row { display:flex; gap:8px; align-items:stretch; position:relative; z-index:1; }
      .lw-code-box { flex:1; background:color-mix(in srgb, var(--lw-text) 8%, transparent); border:1px solid color-mix(in srgb, var(--lw-text) 15%, transparent); border-radius:var(--lw-radius-sm); padding:10px 14px; font-size:14px; font-weight:600; letter-spacing:0.08em; color:var(--lw-accent); font-family:'JetBrains Mono',monospace; }
      .lw-copy-btn { background:var(--lw-btn-bg); color:var(--lw-btn-text); border:none; border-radius:var(--lw-radius-sm); padding:10px 16px; font-size:12.5px; font-weight:700; cursor:pointer; font-family:'Inter',sans-serif; transition:all 0.15s; white-space:nowrap; display:inline-flex; align-items:center; gap:6px; justify-content:center; }
      .lw-copy-btn:hover { opacity:0.88; }
      .lw-copy-btn.copied { background:var(--lw-accent-dark); color:var(--lw-text); }
      .lw-share-btn-full { margin-top:8px; width:100%; border-radius:var(--lw-radius-sm); padding:11px; position:relative; z-index:1; }

      /* Signup */
      .lw-signup-wrap { display:grid; grid-template-columns:1.1fr 0.9fr; gap:0; border-radius:var(--lw-radius-lg); overflow:hidden; box-shadow:var(--lw-shadow); }
      .lw-signup { background: radial-gradient(140% 140% at 10% 0%, var(--lw-accent) 0%, var(--lw-accent-dark) 70%); padding:44px 42px; color:var(--lw-text); position:relative; overflow:hidden; }
      .lw-signup::before { content:''; position:absolute; top:-60px; right:-60px; width:220px; height:220px; background:radial-gradient(circle, color-mix(in srgb, var(--lw-text) 25%, transparent) 0%, transparent 70%); pointer-events:none; }
      .lw-signup-badge { display:inline-flex; align-items:center; gap:6px; background:color-mix(in srgb, var(--lw-text) 16%, transparent); border:1px solid color-mix(in srgb, var(--lw-text) 30%, transparent); border-radius:999px; padding:5px 13px; font-size:11px; font-weight:700; letter-spacing:0.08em; color:var(--lw-text); text-transform:uppercase; margin-bottom:22px; position:relative; z-index:1; }
      .lw-signup h2 { font-family:'Space Grotesk',sans-serif; font-size:32px; line-height:1.15; margin:0 0 12px; font-weight:700; color:var(--lw-text); position:relative; z-index:1; }
      .lw-signup p { font-size:14.5px; color:color-mix(in srgb, var(--lw-text) 85%, transparent); margin:0 0 28px; line-height:1.6; position:relative; z-index:1; max-width:380px; }
      .lw-perks { display:flex; gap:12px; margin-bottom:0; flex-wrap:wrap; position:relative; z-index:1; }
      .lw-perk { background:color-mix(in srgb, var(--lw-text) 12%, transparent); border:1px solid color-mix(in srgb, var(--lw-text) 20%, transparent); border-radius:var(--lw-radius-sm); padding:12px 14px; font-size:12.5px; color:var(--lw-text); flex:1; min-width:100px; text-align:center; }
      .lw-perk-icon { display:flex; justify-content:center; margin-bottom:6px; }
      .lw-signup-form { background:#fff; padding:44px 42px; display:flex; flex-direction:column; justify-content:center; }
      .lw-signup-form-label { display:block; font-size:11.5px; font-weight:700; color:var(--lw-muted); margin-bottom:8px; letter-spacing:0.06em; text-transform:uppercase; }
      .lw-signup-form input { width:100%; box-sizing:border-box; background:#f7f7f6; border:1.5px solid var(--lw-line); border-radius:var(--lw-radius-sm); padding:13px 15px; font-size:14px; font-family:'Inter',sans-serif; color:var(--lw-ink); outline:none; transition:border-color 0.15s; margin-bottom:22px; }
      .lw-signup-form input:focus { border-color:var(--lw-accent); }
      .lw-btn { display:block; width:100%; padding:15px 24px; border-radius:var(--lw-radius-md); border:none; cursor:pointer; font-family:'Inter',sans-serif; font-size:15px; font-weight:700; letter-spacing:0.01em; transition:all 0.2s ease; text-align:center; }
      .lw-btn-primary { background:var(--lw-btn-bg); color:var(--lw-btn-text); }
      .lw-btn-primary:hover:not(:disabled) { opacity:0.9; transform:translateY(-1px); box-shadow:0 8px 22px rgba(0,0,0,0.15); }
      .lw-btn-primary:disabled { opacity:0.6; cursor:not-allowed; transform:none; }
      .lw-signup-note { margin-top:14px; font-size:11.5px; color:var(--lw-muted-2); text-align:center; }

      .lw-loading { display:flex; align-items:center; justify-content:center; padding:60px; color:var(--lw-muted-2); font-size:13px; gap:8px; }
      .lw-not-logged-in { text-align:center; padding:60px 24px; background:#f9f9f8; border-radius:var(--lw-radius-lg); border:1px dashed var(--lw-line); }
      .lw-not-logged-in .lw-not-logged-icon { display:flex; justify-content:center; margin-bottom:8px; color:var(--lw-muted); }
      .lw-not-logged-in p { font-size:14px; color:var(--lw-muted); margin:8px 0 22px; }
      .lw-not-logged-in a { display:inline-block; background:var(--lw-btn-bg); color:var(--lw-btn-text); text-decoration:none; padding:12px 28px; border-radius:var(--lw-radius-sm); font-size:14px; font-weight:700; transition:opacity 0.15s; }
      .lw-not-logged-in a:hover { opacity:0.85; }

      @media (max-width:900px) {
        .lw-hero-grid, .lw-lower-grid, .lw-signup-wrap { grid-template-columns:1fr; }
        .lw-tier-row { grid-template-columns:1fr; }
        .lw-heading { font-size:26px; }
        .lw-signup, .lw-signup-form { padding:30px 24px; }
        .lw-tx-type-pill { display:none; }
      }
    `;
    document.head.appendChild(style);
  }

  // ── Apply style from API ───────────────────────────────────────────────────
  // Pulls the merchant's LoyaltySettings (accentColor, bgColor, textColor,
  // buttonColor, buttonTextColor, borderRadius) and maps them straight onto
  // the CSS custom properties defined on .lw-root above.
  async function applyStyle() {
    if (!APP_URL || !SHOP) return;
    try {
      const res = await fetch(`${APP_URL}/api/loyalty-style?shop=${encodeURIComponent(SHOP)}`);
      if (!res.ok) return;
      const s = await res.json();
      const root = document.getElementById("loyalty-widget-root");
      if (!root) return;
      if (s.accentColor) root.style.setProperty("--lw-accent", s.accentColor);
      if (s.bgColor) root.style.setProperty("--lw-bg", s.bgColor);
      if (s.textColor) root.style.setProperty("--lw-text", s.textColor);
      if (s.buttonColor) root.style.setProperty("--lw-btn-bg", s.buttonColor);
      if (s.buttonTextColor) root.style.setProperty("--lw-btn-text", s.buttonTextColor);
      if (s.borderRadius != null) root.style.setProperty("--lw-radius", `${s.borderRadius}px`);
    } catch (e) { }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function formatDate(iso) {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  function formatExpiry(iso) {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  function txIcon(type, status) {
    if (status === "pending") return { icon: svgIcon("clock", 16), bg: "#fef3c7", color: "#92400e" };
    if (status === "voided" || status === "deducted") return { icon: svgIcon("undo", 16), bg: "#fee2e2", color: "#b91c1c" };
    if (type === "earn") return { icon: svgIcon("star", 15), bg: "var(--lw-accent-soft)", color: "var(--lw-accent-dark)" };
    if (type === "redeem") return { icon: svgIcon("ticket", 16), bg: "var(--lw-bg-soft)", color: "var(--lw-bg)" };
    if (type === "adjust") return { icon: svgIcon("edit", 15), bg: "#e0e7ff", color: "#4338ca" };
    return { icon: svgIcon("clipboard", 15), bg: "#f3f4f6", color: "#6b7280" };
  }
  function txPointsClass(type, status) {
    if (status === "pending") return "pending";
    if (status === "voided" || status === "deducted") return "redeem";
    return type === "earn" ? "earn" : type === "redeem" ? "redeem" : "";
  }
  function txPointsLabel(type, status, points) {
    if (status === "voided") return `−${Math.abs(points)} (void)`;
    if (status === "deducted") return `−${Math.abs(points)}`;
    if (status === "pending") return `+${points} (pending)`;
    if (type === "earn") return `+${points}`;
    if (type === "redeem") return `−${Math.abs(points)}`;
    return `${points > 0 ? "+" : ""}${points}`;
  }
  function txTypeLabel(type, status) {
    if (status === "pending") return "Pending";
    if (status === "voided" || status === "deducted") return "Adjusted";
    if (type === "earn") return "Earned";
    if (type === "redeem") return "Redeemed";
    if (type === "adjust") return "Adjusted";
    return "Activity";
  }
  function txDesc(tx) {
    if (tx.note) return tx.note;
    if (tx.orderName) return `Order ${tx.orderName}`;
    if (tx.type === "earn") return "Points earned";
    if (tx.type === "redeem") return "Points redeemed";
    if (tx.type === "adjust") return "Manual adjustment";
    return "Transaction";
  }

  // ── Tier stepper row (Bronze → Silver → Gold) ─────────────────────────────
  function renderTierRow(customer, tierProgress) {
    const currentTier = customer.tier || "bronze";
    const currentIdx = TIER_ORDER.indexOf(currentTier);

    const cards = TIER_ORDER.map((t, i) => {
      const label = t.charAt(0).toUpperCase() + t.slice(1);
      let stateClass = "upcoming";
      let badgeClass = "";
      let badgeLabel = "Locked";
      let status = "";
      let showBar = false;
      let fillPct = 0;

      if (i < currentIdx) {
        stateClass = "completed";
        badgeLabel = "Unlocked";
        status = "Completed";
      } else if (i === currentIdx) {
        stateClass = "current";
        badgeClass = "current";
        badgeLabel = "Current";
        showBar = true;
        if (tierProgress.nextTier) {
          status = `${tierProgress.pointsToNext.toLocaleString()} pts to go`;
          fillPct = tierProgress.progressPercent;
        } else {
          status = "Top tier";
          fillPct = 100;
        }
      } else if (tierProgress.nextTier === t) {
        status = `${tierProgress.pointsToNext.toLocaleString()} pts away`;
      } else {
        status = "Locked";
      }

      return `<div class="lw-tier-card ${stateClass}">
        <div class="lw-tier-card-head">
          <div class="lw-tier-card-name">${svgIcon("award", 16)} ${label}</div>
          ${i <= currentIdx ? `<span class="lw-tier-badge-sm ${badgeClass}">${badgeLabel}</span>` : ""}
        </div>
        <div class="lw-tier-card-status">${status}</div>
        ${showBar ? `<div class="lw-tier-mini-track"><div class="lw-tier-mini-fill" style="width:${fillPct}%"></div></div>` : ""}
      </div>`;
    }).join("");

    return `<div class="lw-tier-row">${cards}</div>`;
  }

  // ── Render: Not logged in ──────────────────────────────────────────────────
  function renderNotLoggedIn(container) {
    container.innerHTML = `
      <div class="lw-root">
        <div class="lw-not-logged-in">
          <div class="lw-not-logged-icon">${svgIcon("lock", 32)}</div>
          <p>Log in to join our loyalty program and start earning rewards.</p>
          <a href="/account/login">Log in to your account</a>
        </div>
      </div>`;
  }

  // ── Render: Signup ─────────────────────────────────────────────────────────
  function renderSignup(container, onEnrolled) {
    const refCode = REF_CODE || "";

    container.innerHTML = `
    <div class="lw-root">
      <div class="lw-signup-wrap">
        <div class="lw-signup">
          <div class="lw-signup-badge">${svgIcon("star", 12)} New — Loyalty Program</div>
          <h2>Earn rewards on every purchase</h2>
          <p>Join thousands of members earning points, unlocking tiers, and getting exclusive perks.</p>
          <div class="lw-perks">
            <div class="lw-perk"><span class="lw-perk-icon">${svgIcon("star", 20)}</span>Earn points</div>
            <div class="lw-perk"><span class="lw-perk-icon">${svgIcon("target", 20)}</span>Unlock tiers</div>
            <div class="lw-perk"><span class="lw-perk-icon">${svgIcon("gift", 20)}</span>Get rewards</div>
          </div>
        </div>
        <div class="lw-signup-form">
          <label class="lw-signup-form-label">Referral code (optional)</label>
          <input id="lw-referral-input" type="text" placeholder="Enter referral code" value="${refCode}" />
          <button class="lw-btn lw-btn-primary" id="lw-join-btn">Join for free</button>
          <p class="lw-signup-note">No credit card needed. Instant enrollment.</p>
        </div>
      </div>
    </div>`;

    document.getElementById("lw-join-btn").addEventListener("click", async function () {
      const btn = this;
      const referralCode = document.getElementById("lw-referral-input").value.trim() || null;

      btn.disabled = true; btn.textContent = "Joining...";
      try {
        const res = await fetch(`${APP_URL}/api/loyalty-signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shop: SHOP,
            customerId: CUSTOMER_ID,
            email: window.__LOYALTY_CUSTOMER_EMAIL__ || null,
            firstName: window.__LOYALTY_CUSTOMER_FIRST_NAME__ || null,
            lastName: window.__LOYALTY_CUSTOMER_LAST_NAME__ || null,
            referralCode: referralCode,
          }),
        });
        const data = await res.json();
        if (data.success) { onEnrolled(); }
        else { btn.disabled = false; btn.textContent = "Try again"; }
      } catch (e) { btn.disabled = false; btn.textContent = "Try again"; }
    });
  }

  // ── Render: Dashboard ─────────────────────────────────────────────────────
  function renderDashboard(container, data) {
    const { customer, tierProgress, transactions, vouchers = [], redemptionPresets = [] } = data;
    const referral = data.referral || {};
    const referralCode = referral.code || '';
    const tier = customer.tier || "bronze";
    const name = customer.firstName || "Member";
    const currentPoints = customer.points;

    const heroProgress = tierProgress.nextTier ? `
      <div class="lw-hero-progress-row">
        <span class="lw-pts-now">${currentPoints.toLocaleString()}</span>
        <span>/ ${(currentPoints + tierProgress.pointsToNext).toLocaleString()} pts</span>
      </div>
      <div class="lw-track"><div class="lw-track-fill" style="width:${tierProgress.progressPercent}%"></div></div>
      <div class="lw-hero-hint">${tierProgress.pointsToNext.toLocaleString()} pts to reach ${tierProgress.nextTier}</div>
    ` : `
      <div class="lw-hero-progress-row"><span class="lw-pts-now">${currentPoints.toLocaleString()}</span><span>pts</span></div>
      <div class="lw-track"><div class="lw-track-fill" style="width:100%"></div></div>
      <div class="lw-hero-hint">${svgIcon("award", 14)} You've reached our highest tier!</div>
    `;

    const topVoucher = vouchers[0];
    const panelVoucherBlock = topVoucher ? `
      <div class="lw-panel-row">
        <div>
          <div class="lw-panel-row-value">$${topVoucher.discountAmount.toFixed(2)}</div>
          <div class="lw-panel-row-label">Active voucher · ${topVoucher.code}</div>
        </div>
        <button class="lw-btn-pill" id="lw-hero-copy-voucher" data-code="${topVoucher.code}">Copy code</button>
      </div>
    ` : `<div class="lw-panel-row"><div class="lw-panel-empty" style="text-align:left;">No active vouchers yet — redeem points below to get one.</div></div>`;

    const txRows = transactions.length
      ? transactions.map((tx) => {
        const { icon, bg, color } = txIcon(tx.type, tx.status);
        return `<li class="lw-tx-item">
            <div class="lw-tx-icon" style="background:${bg};color:${color}">${icon}</div>
            <div class="lw-tx-meta">
              <div class="lw-tx-desc">${txDesc(tx)}</div>
              <div class="lw-tx-date">${formatDate(tx.createdAt)}</div>
            </div>
            <span class="lw-tx-type-pill ${txPointsClass(tx.type, tx.status)}">${txTypeLabel(tx.type, tx.status)}</span>
            <div class="lw-tx-pts ${txPointsClass(tx.type, tx.status)}">${txPointsLabel(tx.type, tx.status, tx.points)}</div>
          </li>`;
      }).join("")
      : `<div class="lw-tx-empty">No transactions yet. Start shopping to earn points!</div>`;

    const presetRows = redemptionPresets.map((p) => {
      const canAfford = p.canAfford !== undefined ? p.canAfford : currentPoints >= p.points;
      return `<button class="lw-preset ${canAfford ? "" : "disabled"}" data-points="${p.points}" ${canAfford ? "" : "disabled"}>
        <span class="lw-preset-pts">${p.points.toLocaleString()} pts</span>
        <span style="display:flex;align-items:center;">
          <span class="lw-preset-val">$${(p.value || p.discountAmount || 0).toFixed(2)} off</span>
          <span class="lw-preset-arrow">→</span>
        </span>
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
        <div class="lw-eyebrow">Loyalty Program</div>
        <h1 class="lw-heading">Welcome back, ${name}</h1>
        <p class="lw-subheading">Track your tier progress, redeem points for rewards, and share your referral code.</p>

        <div class="lw-hero-grid">
          <div class="lw-hero-card">
            <div class="lw-hero-top">
              <div>
                <div class="lw-hero-greeting">Current tier</div>
                <div class="lw-hero-tier">${tier}</div>
              </div>
              <div class="lw-hero-icon">${svgIcon("award", 20)}</div>
            </div>
            <div class="lw-hero-progress">${heroProgress}</div>
          </div>

          <div class="lw-panel">
            <div class="lw-panel-heading">Your rewards</div>
            ${panelVoucherBlock}
            <div class="lw-panel-row">
              <div>
                <div class="lw-code-chip-sm">${referralCode || "—"}</div>
                <div class="lw-panel-row-label" style="margin-top:6px;">Your referral code</div>
              </div>
              <button class="lw-btn-pill" id="lw-hero-copy-referral">Copy code</button>
            </div>
          </div>
        </div>

        ${renderTierRow(customer, tierProgress)}

        <div class="lw-lower-grid">
          
           <div class="lw-referral-card">
              <div class="lw-referral-label">Refer & Earn</div>
              <div class="lw-referral-title">Share your code, both of you win</div>
              <div class="lw-referral-sub">
                ${referral.signupBonus ? `Your friend gets <strong style="color:var(--lw-accent)">${referral.signupBonus} pts</strong> on signup. ` : ''}
                ${referral.referrerPct ? `You earn <strong style="color:var(--lw-accent)">${referral.referrerPct}%</strong> bonus on their first order.` : ''}
              </div>
              ${referral.totalReferrals != null ? `
              <div class="lw-referral-stats">
                <div><div class="lw-referral-stat-num">${referral.totalReferrals}</div><div class="lw-referral-stat-label">Referred</div></div>
                <div><div class="lw-referral-stat-num">${referral.completedReferrals || 0}</div><div class="lw-referral-stat-label">Completed</div></div>
              </div>` : ''}
              <div class="lw-referral-code-row">
                <div class="lw-code-box">${referralCode}</div>
                <button class="lw-copy-btn" id="lw-copy-referral">Copy</button>
              </div>
              <button class="lw-copy-btn lw-share-btn-full" id="lw-share-btn">${svgIcon("link", 14)} Copy share link</button>
            </div>
         

          <div>
            <div class="lw-card">
              <div class="lw-card-head">
                <div class="lw-card-title">Redeem points</div>
                <span class="lw-redeem-rate-pill">${svgIcon("award", 13)} ${tier} rate</span>
              </div>
              <div class="lw-redeem-balance">
                <div>
                  <div class="lw-redeem-balance-pts" id="lw-redeem-pts">${currentPoints.toLocaleString()}</div>
                  <div class="lw-redeem-balance-label">points available</div>
                </div>
              </div>
              <div class="lw-presets" id="lw-presets">
                ${presetRows.length ? presetRows : '<div class="lw-tx-empty">No redemption options available.</div>'}
              </div>
              <div class="lw-custom-redeem" id="lw-custom-redeem">
                <div class="lw-custom-redeem-label">Custom amount</div>
                <div class="lw-custom-redeem-row">
                  <input type="number" class="lw-custom-input" id="lw-custom-pts-input" min="2000" step="100" placeholder="e.g. 2500" />
                  <button class="lw-custom-submit" id="lw-custom-submit">Redeem</button>
                </div>
                <div class="lw-custom-hint" id="lw-custom-hint">Min 2,000 pts · must be a multiple of 100</div>
              </div>
              ${vouchers.length ? `<div class="lw-vouchers-heading">Your active vouchers</div>${voucherRows}` : ""}
            </div>

            
          </div>
                   
          </div>
          <div class="lw-lower">
          <div class="lw-card">
            <div class="lw-card-head">
              <div class="lw-card-title">Transaction history</div>
            </div>
            <ul class="lw-tx-list">${txRows}</ul>
            </div>
            </div>
        </div>
      </div>`;

    // Hero panel quick copy buttons
    document.getElementById("lw-hero-copy-voucher")?.addEventListener("click", function () {
      navigator.clipboard.writeText(this.dataset.code).then(() => {
        this.textContent = "Copied!";
        setTimeout(() => { this.textContent = "Copy code"; }, 2000);
      });
    });
    document.getElementById("lw-hero-copy-referral")?.addEventListener("click", function () {
      navigator.clipboard.writeText(referralCode).then(() => {
        this.textContent = "Copied!";
        setTimeout(() => { this.textContent = "Copy code"; }, 2000);
      });
    });

    // Copy referral (referral card)
    document.getElementById("lw-copy-referral")?.addEventListener("click", function () {
      navigator.clipboard.writeText(referralCode).then(() => {
        this.textContent = "Copied!"; this.classList.add("copied");
        setTimeout(() => { this.textContent = "Copy"; this.classList.remove("copied"); }, 2000);
      });
    });
    document.getElementById("lw-share-btn")?.addEventListener("click", function () {
      const shareUrl = `${window.location.origin}/pages/loyalty-rewards?ref=${encodeURIComponent(referralCode)}`;
      navigator.clipboard.writeText(shareUrl).then(() => {
        this.innerHTML = `${svgIcon("checkCircle", 14)} Link copied!`; this.classList.add("copied");
        setTimeout(() => { this.innerHTML = `${svgIcon("link", 14)} Copy share link`; this.classList.remove("copied"); }, 2000);
      });
    });

    // Copy voucher codes (voucher list)
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
        await doRedeem(pts);
      });
    });

    async function doRedeem(pts) {
      redeeming = true;
      const presetsEl = document.getElementById("lw-presets");
      const customEl = document.getElementById("lw-custom-redeem");
      presetsEl.innerHTML = `<div class="lw-redeem-loading"><span class="lw-spinner"></span> Generating your discount code…</div>`;
      if (customEl) customEl.style.display = "none";

      try {
        const res = await fetch(`${APP_URL}/api/loyalty-redeem`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shop: SHOP, customerId: CUSTOMER_ID, pointsToRedeem: pts }),
        });
        const result = await res.json();

        if (result.success) {
          const newBalance = result.newBalance;
          const redeemPts = document.getElementById("lw-redeem-pts");
          if (redeemPts) redeemPts.textContent = newBalance.toLocaleString();

          presetsEl.innerHTML = `
            <div style="text-align:center;padding:16px 0 20px;">
              <div style="display:flex;justify-content:center;margin-bottom:8px;color:var(--lw-accent-dark);">${svgIcon("checkCircle", 30)}</div>
              <div style="font-size:15px;font-weight:600;color:var(--lw-ink);margin-bottom:4px;">Discount code ready!</div>
              <div style="font-size:13px;color:var(--lw-muted);margin-bottom:16px;">Valid for 30 days · One-time use</div>
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
            <button class="lw-btn" style="background:#f3f4f6;color:var(--lw-ink);margin-top:12px;" id="lw-redeem-again">Redeem more points</button>
          `;

          presetsEl.querySelector(".lw-copy-code-btn")?.addEventListener("click", function () {
            navigator.clipboard.writeText(this.dataset.code).then(() => {
              this.textContent = "Copied!"; this.classList.add("copied");
              setTimeout(() => { this.textContent = "Copy"; this.classList.remove("copied"); }, 2000);
            });
          });
          document.getElementById("lw-redeem-again")?.addEventListener("click", () => init());
        } else {
          presetsEl.innerHTML = `<div class="lw-tx-empty" style="display:flex;align-items:center;justify-content:center;gap:6px;">${svgIcon("alertTriangle", 14)} ${result.error || "Something went wrong. Please try again."}</div>`;
          if (customEl) customEl.style.display = "";
          setTimeout(() => init(), 2000);
        }
      } catch (e) {
        presetsEl.innerHTML = `<div class="lw-tx-empty" style="display:flex;align-items:center;justify-content:center;gap:6px;">${svgIcon("alertTriangle", 14)} Network error. Please try again.</div>`;
        if (customEl) customEl.style.display = "";
        setTimeout(() => init(), 2000);
      } finally {
        redeeming = false;
      }
    }

    // ── Custom redemption input ──────────────────────────────────────────────
    const customInput = document.getElementById("lw-custom-pts-input");
    const customSubmit = document.getElementById("lw-custom-submit");
    const customHint = document.getElementById("lw-custom-hint");
    const MIN_CUSTOM = 2000;
    const STEP_CUSTOM = 100;

    function validateCustom(val) {
      if (!val || isNaN(val)) return { ok: false, msg: "Enter a number of points." };
      const n = Number(val);
      if (n < MIN_CUSTOM) return { ok: false, msg: `Minimum is ${MIN_CUSTOM.toLocaleString()} pts.` };
      if (n % STEP_CUSTOM !== 0) return { ok: false, msg: `Must be a multiple of ${STEP_CUSTOM}.` };
      if (n > currentPoints) return { ok: false, msg: `You only have ${currentPoints.toLocaleString()} pts.` };
      return { ok: true, msg: `≈ ${(n / (redemptionPresets[0]?.points / (redemptionPresets[0]?.value || 1) || 100)).toFixed(2)} off` };
    }

    customInput?.addEventListener("input", function () {
      const { ok, msg } = validateCustom(this.value);
      customHint.innerHTML = (ok ? "" : svgIcon("alertTriangle", 12)) + msg;
      customHint.className = "lw-custom-hint" + (ok ? "" : " err");
      this.classList.toggle("error", !ok && this.value !== "");
    });

    customSubmit?.addEventListener("click", async function () {
      const { ok, msg } = validateCustom(customInput?.value);
      if (!ok) {
        customHint.innerHTML = svgIcon("alertTriangle", 12) + msg;
        customHint.className = "lw-custom-hint err";
        customInput?.classList.add("error");
        return;
      }
      await doRedeem(Number(customInput.value));
    });
  }

  // ── Main init ──────────────────────────────────────────────────────────────
  async function init() {
    const container = document.getElementById("loyalty-widget-root");
    if (!container) return;

    injectStyles();
    await applyStyle();

    if (!CUSTOMER_ID) { renderNotLoggedIn(container); return; }

    container.innerHTML = `<div class="lw-root"><div class="lw-loading"><span class="lw-spinner"></span> Loading your rewards…</div></div>`;

    try {
      const res = await fetch(`${APP_URL}/api/loyalty-dashboard?shop=${encodeURIComponent(SHOP)}&customerId=${encodeURIComponent(CUSTOMER_ID)}`);
      const data = await res.json();
      if (!data.enrolled) { renderSignup(container, () => init()); }
      else { renderDashboard(container, data); }
    } catch (e) {
      console.error("[loyalty-widget] init error", e);
      container.innerHTML = `<div class="lw-root"><div class="lw-loading">Something went wrong. Please refresh.</div></div>`;
    }
  }

  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", init); }
  else { init(); }
})();