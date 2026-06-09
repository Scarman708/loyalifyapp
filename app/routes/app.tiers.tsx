import { useLoaderData, useFetcher } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useRef } from "react";
import { authenticate } from "../shopify.server";
import { getTierConfig, saveTierConfig } from "../services/tierService";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      [elemName: string]: any;
    }
  }
}

// ── Loader ────────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const config = await getTierConfig(session.shop);
  return { shop: session.shop, config };
};

// ── Action ────────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Support both JSON and FormData submissions
  let bronze: number, silver: number, gold: number;

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await request.json() as { bronze: number; silver: number; gold: number };
    bronze = Number(body.bronze);
    silver = Number(body.silver);
    gold   = Number(body.gold);
  } else {
    const fd = await request.formData();
    bronze = Number(fd.get("bronze"));
    silver = Number(fd.get("silver"));
    gold   = Number(fd.get("gold"));
  }

  const errors: string[] = [];
  if (bronze !== 0)       errors.push("Bronze threshold must be 0 (it's the entry tier).");
  if (silver <= bronze)   errors.push("Silver threshold must be greater than Bronze.");
  if (gold   <= silver)   errors.push("Gold threshold must be greater than Silver.");
  if (silver > 1_000_000) errors.push("Silver threshold seems unreasonably high.");
  if (gold   > 1_000_000) errors.push("Gold threshold seems unreasonably high.");

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  await saveTierConfig(session.shop, { bronze, silver, gold });
  return { ok: true, errors: [] };
};

// ── Tier metadata ─────────────────────────────────────────────────────────────

const TIER_META = {
  bronze: {
    label:       "Bronze",
    emoji:       "🥉",
    description: "Entry tier — all new members start here.",
    color:       "#D85A30",
    bg:          "#FFF4F0",
  },
  silver: {
    label:       "Silver",
    emoji:       "🥈",
    description: "Mid tier — unlocked after reaching the Silver threshold.",
    color:       "#5F5E5A",
    bg:          "#F5F5F4",
  },
  gold: {
    label:       "Gold",
    emoji:       "🥇",
    description: "Top tier — your most loyal customers.",
    color:       "#BA7517",
    bg:          "#FFFBF0",
  },
} as const;

// ── Component ─────────────────────────────────────────────────────────────────

export default function TiersPage() {
  const { config } = useLoaderData<typeof loader>();
  const fetcher    = useFetcher<typeof action>();
  const isSaving   = fetcher.state !== "idle";
  const result     = fetcher.data;

  const silverRef = useRef<HTMLInputElement>(null);
  const goldRef   = useRef<HTMLInputElement>(null);

  // Called from the s-button onClick — reads refs directly to avoid
  // any native form submit issues with Polaris web components
  const handleSave = () => {
    const silver = Number(silverRef.current?.value ?? 0);
    const gold   = Number(goldRef.current?.value ?? 0);

    fetcher.submit(
      { bronze: 0, silver, gold },
      { method: "POST", encType: "application/json" },
    );
  };

  return (
    <s-page heading="Membership Tiers">

      {/* ── How tiers work ── */}
      <s-section heading="How tiers work">
        <s-card>
          <s-stack direction="block" gap="large-400">
            <s-text>
              Tiers are based on <strong>lifetime points earned</strong> — they never
              drop when a customer redeems points. When a customer crosses a threshold,
              their tier is updated in your database, synced to their Shopify customer
              metafield (<code>loyalty.tier</code>), and a tier-change event is fired.
            </s-text>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
              {(["bronze", "silver", "gold"] as const).map((t) => {
                const meta = TIER_META[t];
                return (
                  <div
                    key={t}
                    style={{
                      background:   meta.bg,
                      border:       `1px solid ${meta.color}40`,
                      borderRadius: "8px",
                      padding:      "16px",
                    }}
                  >
                    <div style={{ fontSize: "28px", marginBottom: "8px" }}>{meta.emoji}</div>
                    <div style={{ fontWeight: 600, color: meta.color, marginBottom: "4px" }}>
                      {meta.label}
                    </div>
                    <div style={{ fontSize: "13px", color: "#555" }}>{meta.description}</div>
                  </div>
                );
              })}
            </div>
          </s-stack>
        </s-card>
      </s-section>

      {/* ── Configure thresholds ── */}
      <s-section heading="Configure thresholds">
        <s-card>

          {/* Success banner */}
          {result?.ok === true && (
            <div style={{
              background: "#EAF3DE", border: "1px solid #97C459",
              borderRadius: "8px", padding: "12px 16px",
              marginBottom: "20px", color: "#3B6D11", fontSize: "14px",
            }}>
              ✓ Tier thresholds saved. New thresholds apply to the next point award.
            </div>
          )}

          {/* Error banner */}
          {result?.errors && result.errors.length > 0 && (
            <div style={{
              background: "#FCEBEB", border: "1px solid #F09595",
              borderRadius: "8px", padding: "12px 16px",
              marginBottom: "20px", color: "#A32D2D", fontSize: "14px",
            }}>
              {result.errors.map((e: string) => <div key={e}>⚠ {e}</div>)}
            </div>
          )}

          <s-stack direction="block" gap="large-400">

            {/* Bronze — read only */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                <span style={{ fontSize: "20px" }}>🥉</span>
                <strong style={{ color: TIER_META.bronze.color }}>Bronze</strong>
                <span style={{ fontSize: "13px", color: "#888" }}>— entry tier, always starts at 0</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="number"
                  name="bronze"
                  value={0}
                  readOnly
                  style={{
                    width: "160px", padding: "8px 12px",
                    border: "1px solid #ddd", borderRadius: "6px",
                    background: "#f5f5f5", color: "#888", fontSize: "14px",
                  }}
                />
                <span style={{ fontSize: "13px", color: "#888" }}>lifetime pts</span>
              </div>
            </div>

            {/* Silver */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                <span style={{ fontSize: "20px" }}>🥈</span>
                <strong style={{ color: TIER_META.silver.color }}>Silver starts at</strong>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  ref={silverRef}
                  type="number"
                  name="silver"
                  defaultValue={config.silver}
                  min={1}
                  max={999999}
                  required
                  style={{
                    width: "160px", padding: "8px 12px",
                    border: "1px solid #ccc", borderRadius: "6px", fontSize: "14px",
                  }}
                />
                <span style={{ fontSize: "13px", color: "#888" }}>lifetime pts</span>
              </div>
            </div>

            {/* Gold */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                <span style={{ fontSize: "20px" }}>🥇</span>
                <strong style={{ color: TIER_META.gold.color }}>Gold starts at</strong>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  ref={goldRef}
                  type="number"
                  name="gold"
                  defaultValue={config.gold}
                  min={2}
                  max={1000000}
                  required
                  style={{
                    width: "160px", padding: "8px 12px",
                    border: "1px solid #ccc", borderRadius: "6px", fontSize: "14px",
                  }}
                />
                <span style={{ fontSize: "13px", color: "#888" }}>lifetime pts</span>
              </div>
            </div>

            {/* Save button — onClick reads refs, bypasses form submit entirely */}
            <div>
              <s-button
                variant="primary"
                onClick={handleSave}
                {...(isSaving ? { loading: true } : {})}
              >
                {isSaving ? "Saving…" : "Save thresholds"}
              </s-button>
            </div>

          </s-stack>
        </s-card>
      </s-section>

      {/* ── Storefront usage ── */}
      <s-section heading="Using tiers in your storefront">
        <s-card>
          <s-stack direction="block" gap="large-300">
            <s-text>
              When a tier changes, the value is written to the customer metafield{" "}
              <code>loyalty.tier</code> (type: <code>single_line_text_field</code>).
              Use it in Liquid like this:
            </s-text>
            <div style={{
              background: "#1e1e2e", borderRadius: "8px", padding: "16px",
              fontFamily: "monospace", fontSize: "13px",
              color: "#cdd6f4", overflowX: "auto",
            }}>
              <span style={{ color: "#89b4fa" }}>{`{% assign`}</span>
              {` tier = customer.metafields.loyalty.tier.value `}
              <span style={{ color: "#89b4fa" }}>{`%}`}</span>
              <br />
              <span style={{ color: "#89b4fa" }}>{`{% if`}</span>
              {` tier == `}
              <span style={{ color: "#a6e3a1" }}>"gold"</span>
              {` `}
              <span style={{ color: "#89b4fa" }}>{`%}`}</span>
              <br />
              {"  "}<span style={{ color: "#f38ba8" }}>{`<p>`}</span>
              {`You're a Gold member! 🥇`}
              <span style={{ color: "#f38ba8" }}>{`</p>`}</span>
              <br />
              <span style={{ color: "#89b4fa" }}>{`{% endif %}`}</span>
            </div>
          </s-stack>
        </s-card>
      </s-section>

    </s-page>
  );
}