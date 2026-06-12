const PAGE_TITLE = "Loyalty Rewards";
const APP_URL    = process.env.SHOPIFY_APP_URL || "";

function buildPageBody(): string {
  return `<div id="loyalty-widget-root" data-app-url="${APP_URL}"></div>`;
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
        namespace: "loyalty", key: "app_url",
        type: "single_line_text_field", value: APP_URL, ownerId: shopGid,
      }],
    },
  });
  const data = await res.json();
  const errors = data.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) { console.error("[loyaltyPageSetup] metafield errors:", errors); }
  else { console.log(`[loyaltyPageSetup] Wrote loyalty.app_url = ${APP_URL}`); }
}

async function getShopGid(admin: any): Promise<string> {
  const res  = await admin.graphql(`query { shop { id } }`);
  const data = await res.json();
  return data.data.shop.id;
}

async function createLoyaltyPage(admin: any): Promise<void> {
  const checkRes  = await admin.graphql(`
    query { pages(first: 5, query: "title:'Loyalty Rewards'") { nodes { id title handle } } }
  `);
  const pages    = (await checkRes.json()).data?.pages?.nodes ?? [];
  const existing = pages.find((p: any) => p.title === PAGE_TITLE);

  if (existing) {
    console.log(`[loyaltyPageSetup] Page already exists at /pages/${existing.handle}, skipping`);
    return;
  }

  const createRes  = await admin.graphql(`
    mutation CreatePage($page: PageCreateInput!) {
      pageCreate(page: $page) {
        page { id title handle }
        userErrors { field message }
      }
    }
  `, { variables: { page: { title: PAGE_TITLE, body: buildPageBody(), isPublished: true } } });

  const createData = await createRes.json();
  const errors     = createData.data?.pageCreate?.userErrors ?? [];
  if (errors.length) { console.error("[loyaltyPageSetup] Page errors:", errors); }
  else { console.log(`[loyaltyPageSetup] Created page → /pages/${createData.data?.pageCreate?.page?.handle}`); }
}