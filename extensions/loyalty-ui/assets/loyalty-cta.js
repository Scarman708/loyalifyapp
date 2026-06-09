// extensions/loyalty-ui/assets/loyalty-cta.js
// CTA block — heading, description, button
// If not enrolled → signup → success msg → redirect to /pages/loyalty-rewards
// If already enrolled → redirect to /pages/loyalty-rewards immediately

(function () {
  "use strict";

  const APP_URL = window.__LOYALTY_APP_URL__ || "";
  const SHOP = window.__LOYALTY_SHOP__ || Shopify.shop;
  const CUSTOMER_ID = window.__LOYALTY_CUSTOMER_ID__ || null;
  const DASHBOARD_URL = "/pages/loyalty-rewards";
  const REF_CODE = new URLSearchParams(window.location.search).get("ref") || null;
  // ── Inject styles ────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById("loyalty-cta-styles")) return;
    const style = document.createElement("style");
    style.id = "loyalty-cta-styles";
    style.textContent = `


      .lc-root {
        font-family: 'DM Sans', sans-serif;
        max-width: 640px;
        margin: 0 auto;
        padding: 8px;
      }

      .lc-card {
        background: #0d0d0d;
        border-radius: 20px;
        padding: 48px 44px;
        position: relative;
        overflow: hidden;
        text-align: center;
      }

      /* Decorative glows */
      .lc-card::before {
        content: '';
        position: absolute;
        top: -80px; left: 50%;
        transform: translateX(-50%);
        width: 300px; height: 300px;
        background: radial-gradient(circle, rgba(212,160,23,0.18) 0%, transparent 65%);
        pointer-events: none;
      }
      .lc-card::after {
        content: '';
        position: absolute;
        bottom: -60px; right: -60px;
        width: 200px; height: 200px;
        background: radial-gradient(circle, rgba(212,160,23,0.1) 0%, transparent 65%);
        pointer-events: none;
      }

      .lc-eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: rgba(212,160,23,0.12);
        border: 1px solid rgba(212,160,23,0.35);
        border-radius: 999px;
        padding: 5px 14px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.1em;
        color: #d4a017;
        text-transform: uppercase;
        margin-bottom: 24px;
      }

      .lc-heading {
        font-family: 'DM Serif Display', serif;
        font-size: 36px;
        font-weight: 400;
        color: #fff;
        line-height: 1.15;
        margin: 0 0 14px;
      }
      .lc-heading em { font-style: italic; color: #d4a017; }

      .lc-desc {
        font-size: 15px;
        color: rgba(255,255,255,0.55);
        line-height: 1.7;
        margin: 0 0 36px;
        max-width: 420px;
        margin-left: auto;
        margin-right: auto;
      }

      /* State: idle */
      .lc-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 15px 36px;
        border-radius: 12px;
        border: none;
        cursor: pointer;
        font-family: 'DM Sans', sans-serif;
        font-size: 15px;
        font-weight: 600;
        letter-spacing: 0.01em;
        transition: all 0.2s ease;
        background: #d4a017;
        color: #0d0d0d;
        min-width: 200px;
      }
      .lc-btn:hover:not(:disabled) {
        background: #e8b420;
        transform: translateY(-2px);
        box-shadow: 0 8px 28px rgba(212,160,23,0.4);
      }
      .lc-btn:disabled {
        opacity: 0.65;
        cursor: not-allowed;
        transform: none;
      }

      .lc-btn-spinner {
        width: 16px; height: 16px;
        border: 2px solid rgba(0,0,0,0.2);
        border-top-color: #0d0d0d;
        border-radius: 50%;
        animation: lc-spin 0.7s linear infinite;
        flex-shrink: 0;
      }
      @keyframes lc-spin { to { transform: rotate(360deg); } }

      /* State: success */
      .lc-success {
        display: none;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        animation: lc-fadein 0.4s ease;
      }
      .lc-success.show { display: flex; }
      .lc-success-icon {
        width: 56px; height: 56px;
        background: rgba(26,122,74,0.15);
        border: 1px solid rgba(26,122,74,0.4);
        border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: 24px;
      }
      .lc-success-title {
        font-family: 'DM Serif Display', serif;
        font-size: 22px;
        color: #fff;
        font-weight: 400;
      }
      .lc-success-sub {
        font-size: 13px;
        color: rgba(255,255,255,0.45);
      }
      .lc-redirect-bar {
        width: 160px;
        height: 3px;
        background: rgba(255,255,255,0.1);
        border-radius: 999px;
        overflow: hidden;
        margin-top: 4px;
      }
      .lc-redirect-fill {
        height: 100%;
        background: #d4a017;
        border-radius: 999px;
        width: 0%;
        transition: width 2.2s linear;
      }

      /* State: not logged in */
      .lc-login-prompt {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
      }
      .lc-login-note {
        font-size: 13px;
        color: rgba(255,255,255,0.4);
      }
      .lc-login-link {
        display: inline-block;
        padding: 13px 32px;
        background: transparent;
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 10px;
        color: #fff;
        text-decoration: none;
        font-size: 14px;
        font-weight: 600;
        font-family: 'DM Sans', sans-serif;
        transition: all 0.15s;
      }
      .lc-login-link:hover {
        background: rgba(255,255,255,0.07);
        border-color: rgba(255,255,255,0.4);
      }

      @keyframes lc-fadein {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }

      @media (max-width: 480px) {
        .lc-card { padding: 36px 24px; }
        .lc-heading { font-size: 28px; }
      }
    `;
    document.head.appendChild(style);
  }

  // ── Render ───────────────────────────────────────────────────────────────
  function render(container, { heading, description, buttonText }) {
    container.innerHTML = `
      <div class="lc-root">
        <div class="lc-card">
          <div class="lc-eyebrow">✦ Loyalty Program</div>
          <h2 class="lc-heading">${heading}</h2>
          <p class="lc-desc">${description}</p>

          ${CUSTOMER_ID ? `
            <div id="lc-action">
              <button class="lc-btn" id="lc-join-btn">
                <span id="lc-btn-label">${buttonText}</span>
              </button>
            </div>
            <div class="lc-success" id="lc-success">
              <div class="lc-success-icon">✓</div>
              <div class="lc-success-title">You're enrolled!</div>
              <div class="lc-success-sub">Redirecting to your dashboard…</div>
              <div class="lc-redirect-bar"><div class="lc-redirect-fill" id="lc-fill"></div></div>
            </div>
          ` : `
            <div class="lc-login-prompt">
              <span class="lc-login-note">Log in to join the loyalty program</span>
              <a class="lc-login-link" href="/account/login?return_url=/pages/loyalty-rewards">Log in to join</a>
            </div>
          `}
        </div>
      </div>
    `;

    if (!CUSTOMER_ID) return;

    const btn = document.getElementById("lc-join-btn");
    const btnLabel = document.getElementById("lc-btn-label");
    const successEl = document.getElementById("lc-success");
    const actionEl = document.getElementById("lc-action");

    btn.addEventListener("click", async function () {
      btn.disabled = true;
      btnLabel.textContent = "";
      btn.innerHTML = `<div class="lc-btn-spinner"></div><span>Please wait…</span>`;

      try {
        // Check enrollment status first
        const dashRes = await fetch(
          `${APP_URL}/api/loyalty-dashboard?shop=${encodeURIComponent(SHOP)}&customerId=${encodeURIComponent(CUSTOMER_ID)}`
        );
        const dashData = await dashRes.json();

        if (dashData.enrolled) {
          // Already enrolled — go straight to dashboard
          window.location.href = DASHBOARD_URL;
          return;
        }

        // Not enrolled — sign up
        const signupRes = await fetch(`${APP_URL}/api/loyalty-signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shop: SHOP,
            customerId: CUSTOMER_ID,
            email: window.__LOYALTY_CUSTOMER_EMAIL__ || null,
            firstName: window.__LOYALTY_CUSTOMER_FIRST_NAME__ || null,
            lastName: window.__LOYALTY_CUSTOMER_LAST_NAME__ || null,
            referralCode: REF_CODE,
          }),
        });

        const signupData = await signupRes.json();

        if (signupData.success) {
          // Show success + animate redirect bar
          actionEl.style.display = "none";
          successEl.classList.add("show");

          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              document.getElementById("lc-fill").style.width = "100%";
            });
          });

          setTimeout(() => {
            window.location.href = DASHBOARD_URL;
          }, 2400);
        } else {
          btn.disabled = false;
          btn.innerHTML = `<span>Try again</span>`;
        }
      } catch (e) {
        console.error("[loyalty-cta] error:", e);
        btn.disabled = false;
        btn.innerHTML = `<span>Try again</span>`;
      }
    });
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  function init() {
    const container = document.getElementById("loyalty-cta-root");
    if (!container) return;

    injectStyles();

    const heading = container.dataset.heading || "Earn rewards on <em>every order</em>";
    const description =
      container.dataset.description ||
      "Join our loyalty program and start earning points with every purchase. Unlock exclusive tiers and redeem rewards.";
    const buttonText = container.dataset.buttonText || "Join the program";

    render(container, { heading, description, buttonText });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();