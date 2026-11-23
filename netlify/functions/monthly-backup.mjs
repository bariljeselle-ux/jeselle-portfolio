// On the 1st of every month (9 AM Philippine time), emails Jeselle last month's income, expenses and clients as CSV files.
import { runMonthlyBackup } from "../lib/core.mjs";
import { runMonthlyCheckin } from "../lib/capacity.mjs";

export default async () => {
  const out = await runMonthlyBackup();
  console.log("monthly backup:", JSON.stringify(out));
  try { console.log("monthly check-in:", JSON.stringify(await runMonthlyCheckin())); } catch (e) { console.log("monthly check-in failed:", e.message); }
};

export const config = { schedule: "0 1 1 * *" };
