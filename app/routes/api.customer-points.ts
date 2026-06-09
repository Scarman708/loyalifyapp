import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getCustomerBalance,
  awardPoints,
  deductPoints,
  syncPointsMetafield,
} from "../services/points.server";

// GET /api/customer-points?customerId=123456789
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const url        = new URL(request.url);
    const customerId = url.searchParams.get("customerId");

    if (!customerId) {
      return Response.json({ error: "customerId is required" }, { status: 400 });
    }

    const customer = await getCustomerBalance(session.shop, customerId);

    if (!customer) {
      return Response.json({ points: 0, transactions: [] });
    }

    return Response.json({
      points:         customer.points,
      lifetimePoints: customer.lifetimePoints,
      tier:           customer.tier,
      transactions:   customer.transactions,
    });
  } catch (error) {
    console.error("Loader error:", error);
    return Response.json({ error: "Authentication failed" }, { status: 401 });
  }
}

// POST /api/customer-points
// body: { customerId, action: "award"|"deduct", points, note? }
export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const body = await request.json();
  const { customerId, action, note } = body;
  const points = Number(body.points); // ← always coerce to number

  if (!customerId || !action || isNaN(points) || points <= 0) {
    return Response.json(
      { error: "customerId, action, and a positive points value are required" },
      { status: 400 }
    );
  }

  let updated;

  if (action === "award") {
    // admin is now the first argument
    updated = await awardPoints(admin, session.shop, customerId, points, { note });
  } else if (action === "deduct") {
    updated = await deductPoints(session.shop, customerId, points, { note });
  } else {
    return Response.json({ error: "action must be award or deduct" }, { status: 400 });
  }

  // Keep Shopify points metafield in sync
  await syncPointsMetafield(admin, customerId, updated.points);

  return Response.json({ success: true, points: updated.points });
}

export default function ApiCustomerPoints() {
  return null;
}