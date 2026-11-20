// Public: returns which call times are already taken (no personal details), so the calendar hides them.
import { crmStore } from "../lib/core.mjs";

export default async () => {
  const store = crmStore();
  const { blobs } = await store.list({ prefix: "booking/" });
  const now = Date.now(), taken = [];
  for (const b of blobs) {
    const r = await store.get(b.key, { type: "json" });
    if (r?.start && new Date(r.start).getTime() > now && !/cancel|lost/i.test(r.status || "")) taken.push(r.start);
  }
  return Response.json({ taken }, { headers: { "Cache-Control": "no-store" } });
};

export const config = { path: "/api/booked" };
