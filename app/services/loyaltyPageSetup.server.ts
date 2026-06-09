// app/services/loyaltyPageSetup.server.ts

const BLOCK_TYPE = `shopify://apps/loyalty-program/blocks/loyalty-widget/d352f77e-1a84-6673-24f2-305e8d76a5518030e602`;
const TEMPLATE_SUFFIX = "loyalty";
const PAGE_TITLE = "Loyalty Rewards";
const APP_URL = process.env.SHOPIFY_APP_URL || "";

// Page body embeds the widget directly — no theme file access needed
function buildPageBody(): string {
  return `
<div id="loyalty-widget-root"></div>
<script>
  window.__LOYALTY_APP_URL__ = "${APP_URL}";
  window.__LOYALTY_SHOP__ = Shopify && Shopify.shop ? Shopify.shop : window.location.hostname;
  {% if customer %}
  window.__LOYALTY_CUSTOMER_ID__ = {{ customer.id }};
  window.__LOYALTY_CUSTOMER_EMAIL__ = {{ customer.email | json }};
  window.__LOYALTY_CUSTOMER_FIRST_NAME__ = {{ customer.first_name | json }};
  window.__LOYALTY_CUSTOMER_LAST_NAME__ = {{ customer.last_name | json }};
  {% else %}
  window.__LOYALTY_CUSTOMER_ID__ = null;
  {% endif %}
</script>
<script src="{{ 'loyalty-widget.js' | asset_url }}" defer></script>
`.trim();
}

export async function setupLoyaltyPage(admin: any): Promise<void> {
  try {
    const shopGid = await getShopGid(admin);
    await writeAppUrlMetafield(admin, shopGid);
    await createLoyaltyPage(admin);
    console.log("[loyaltyPageSetup] ✅ Setup complete");
  } catch (err) {
    console.error("[loyaltyPageSetup] Error during setup:", err);
  }
}

// ── Write loyalty.app_url on Shop ────────────────────────────────────────────
async function writeAppUrlMetafield(admin: any, shopGid: string): Promise<void> {
  const res = await admin.graphql(`
    mutation SetAppUrl($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }
  `, {
    variables: {
      metafields: [{
        namespace: "loyalty",
        key: "app_url",
        type: "single_line_text_field",
        value: APP_URL,
        ownerId: shopGid,
      }],
    },
  });

  const data = await res.json();
  const errors = data.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) {
    console.error("[loyaltyPageSetup] app_url metafield errors:", errors);
  } else {
    console.log(`[loyaltyPageSetup] Wrote loyalty.app_url = ${APP_URL}`);
  }
}

// ── Get Shop GID ─────────────────────────────────────────────────────────────
async function getShopGid(admin: any): Promise<string> {
  const res = await admin.graphql(`query { shop { id } }`);
  const data = await res.json();
  return data.data.shop.id;
}

// ── Create the Loyalty Rewards page ──────────────────────────────────────────
async function createLoyaltyPage(admin: any): Promise<void> {
  // Check if page already exists
  const checkRes = await admin.graphql(`
    query {
      pages(first: 5, query: "title:'Loyalty Rewards'") {
        nodes { id title handle body }
      }
    }
  `);

  const checkData = await checkRes.json();
  const pages = checkData.data?.pages?.nodes ?? [];
  const existing = pages.find((p: any) => p.title === PAGE_TITLE);

  if (existing) {
    console.log(`[loyaltyPageSetup] Page already exists at /pages/${existing.handle}, skipping`);
    return;
  }

  // Create page with widget embedded in body
  const createRes = await admin.graphql(`
    mutation CreatePage($page: PageCreateInput!) {
      pageCreate(page: $page) {
        page { id title handle }
        userErrors { field message }
      }
    }
  `, {
    variables: {
      page: {
        title: PAGE_TITLE,
        body: buildPageBody(),
        isPublished: true,
      },
    },
  });

  const createData = await createRes.json();
  const errors = createData.data?.pageCreate?.userErrors ?? [];

  if (errors.length) {
    console.error("[loyaltyPageSetup] Page create errors:", errors);
  } else {
    const handle = createData.data?.pageCreate?.page?.handle;
    console.log(`[loyaltyPageSetup] Created page: "${PAGE_TITLE}" → /pages/${handle}`);
  }
}