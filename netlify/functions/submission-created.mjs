// Classic Netlify trigger for form submissions (kept as a backup; duplicates are ignored).
import { connectLambda } from "@netlify/blobs";
import { handleSubmission } from "../lib/core.mjs";

export const handler = async (event) => {
  connectLambda(event);
  const { payload } = JSON.parse(event.body || "{}");
  const data = { ...(payload?.data || {}) };
  if (!data.type && payload?.form_name) {
    data.type = payload.form_name === "booking" ? "Booking" : payload.form_name === "project-brief" ? "Project brief" : payload.form_name === "payment" ? "Payment" : "Inquiry";
  }
  const r = await handleSubmission(data);
  console.log("submission-created:", JSON.stringify(r));
  return { statusCode: 200, body: "ok" };
};
