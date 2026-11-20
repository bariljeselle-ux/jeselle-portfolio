// Sends reminder emails to the client and to Jeselle 24 hours and 1 hour before each call.
import { runReminders } from "../lib/core.mjs";

export default async () => {
  const out = await runReminders();
  console.log("reminders:", JSON.stringify(out));
};

export const config = { schedule: "*/15 * * * *" };
