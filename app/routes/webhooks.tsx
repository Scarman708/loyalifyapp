import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  // authenticate.webhook automatically verifies HMAC signature.
  // Returns 401 if invalid — required for Shopify app review.
  const { topic, shop } = await authenticate.webhook(request);

  console.log(`[webhooks] catch-all: ${topic} | shop: ${shop}`);

  return new Response(null, { status: 200 });
};