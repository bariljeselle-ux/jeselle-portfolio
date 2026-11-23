// Public: is Jeselle taking new projects, and what's the earliest start / delivery date? (no client details)
import { loadCapacity, publicCapacity } from "../lib/capacity.mjs";

export default async () => {
  try { return Response.json(publicCapacity(await loadCapacity()), { headers: { "Cache-Control": "public, max-age=60" } }); }
  catch (e) { return Response.json({ error: "unavailable" }, { status: 503 }); }
};

export const config = { path: "/api/capacity" };
