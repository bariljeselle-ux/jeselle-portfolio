// Every morning (9 AM Philippine time) Jeselle gets one email + phone alert listing follow-ups due,
// quotes with no reply after 3 days, new requests not answered after a day, and payments to check.
import { runNudges } from "../lib/core.mjs";

export default async () => {
  const out = await runNudges();
  console.log("nudges:", JSON.stringify(out));
};

export const config = { schedule: "0 1 * * *" };
