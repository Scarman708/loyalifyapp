import type { LoaderFunctionArgs } from "react-router";
import { getLoyaltySettings } from "../services/loyaltySettings.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Content-Type": "application/json",
};

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return new Response(JSON.stringify({ error: "shop is required" }), {
      status: 400, headers: corsHeaders,
    });
  }

  try {
    const settings = await getLoyaltySettings(shop);
    return new Response(JSON.stringify({
      accentColor:     settings.accentColor,
      bgColor:         settings.bgColor,
      textColor:       settings.textColor,
      buttonColor:     settings.buttonColor,
      buttonTextColor: settings.buttonTextColor,
      borderRadius:    settings.borderRadius,
    }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: corsHeaders,
    });
  }
}