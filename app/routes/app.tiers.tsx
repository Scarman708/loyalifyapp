import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// Membership Tiers configuration has moved into the main Settings page
// (Settings → Membership Tiers tab). This route now just redirects there
// so any existing bookmarks, nav entries, or deep links keep working.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return redirect("/app/settings");
};