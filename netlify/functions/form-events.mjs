// Runs automatically every time a form on the site is submitted (new event syntax).
import { handleSubmission } from "../lib/core.mjs";

export default {
  async formSubmitted(event) {
    const r = await handleSubmission(event.data);
    console.log("form-events:", JSON.stringify(r));
  },
};
