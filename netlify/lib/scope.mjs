// Scope check: flags client requests that are NOT in Jeselle's listed services.
// Runs on every inquiry, booking note and project brief. Results show in the
// owner alert email and on the record in the admin page.
//
// HOW TO EDIT: each rule has words to look for (re), a short name, a group and advice.
//   Group A = close to her services → offer as a paid add-on
//   Group B = new but learnable      → ask Claude for steps, honest timeline
//   Group C = outside her skills     → decline politely, refer a specialist
// If you add a new service to the website, delete its rule here so it stops being flagged.

export const SCOPE_RULES = [
  // ---- A: close to what she does (add-on) ----
  { re: /\b(news ?letters?|e-?mail marketing|mailchimp|email campaigns?)\b/i, name: "Email newsletter / email marketing", group: "A" },
  { re: /\b(youtube thumbnails?|thumbnails?)\b/i, name: "YouTube thumbnails", group: "A" },
  { re: /\b(menu (design|board)|restaurant menu)\b/i, name: "Menu design", group: "A" },
  { re: /\b(product (photo|image)s? edit|shopee|lazada|amazon listing|product listings?)\b/i, name: "Online shop product listings / photo editing", group: "A" },
  { re: /\b(data entry|spreadsheet clean ?up|encod(e|ing) data)\b/i, name: "Data entry", group: "A" },
  { re: /\b(print(ing)? (and|&) deliver|print(ed)? (it|them) for (me|us)|printing service)\b/i, name: "Printing (you design; client prints)", group: "A" },
  { re: /\b(logo animation|animated logo|motion graphics?)\b/i, name: "Logo animation / motion graphics", group: "A" },
  // ---- B: new, but learnable ----
  { re: /\b(run(ning)? (my |our |the )?(fb |facebook |meta |ig |instagram )?ads|ads manager|paid ads|boost(ed|ing)? posts?|ad budget|google ads|ppc)\b/i, name: "Running paid ads (Facebook/Google)", group: "B" },
  { re: /\b(shopify|woocommerce|(set ?up|build|create|make|design|launch|start)( me| us)? (an? |my |our |the )?(online (store|shop)|e-?commerce (site|store|website|shop)))\b/i, name: "Online store / e-commerce setup", group: "B" },
  { re: /\b(wordpress|wix|squarespace|elementor)\b/i, name: "Website on WordPress / Wix / Squarespace", group: "B" },
  { re: /\b(podcast)\b/i, name: "Podcast editing", group: "B" },
  { re: /\b(pinterest)\b/i, name: "Pinterest management", group: "B" },
  { re: /\b(youtube (channel|videos?|editing)|long[- ]form video)\b/i, name: "YouTube channel / long video editing", group: "B" },
  { re: /\b(blog (posts?|articles?)|copywriting|ghostwrit\w*|write articles?)\b/i, name: "Blog writing / copywriting", group: "B" },
  { re: /\b(customer (service|support)|chat support|reply to (customers|inquiries) (for|on) (me|us)|inbox management|manage my (email|inbox))\b/i, name: "Customer support / inbox management", group: "B" },
  { re: /\b(cold call\w*|phone calls?|call (my|our) (clients|customers|leads)|appointment setting|telemarketing)\b/i, name: "Phone calls / cold calling (talking-heavy)", group: "B" },
  { re: /\b(lead generation|find (me )?(leads|clients)|cold e-?mail\w*|outreach)\b/i, name: "Lead generation / outreach", group: "B" },
  { re: /\b(translat\w+)\b/i, name: "Translation", group: "B" },
  // ---- C: outside her skills or not allowed ----
  { re: /\b(mobile app|android app|ios app|iphone app|app development|build an app|develop an app|play ?store|app ?store)\b/i, name: "Mobile app development", group: "C" },
  { re: /\b(bookkeep\w*|accounting|tax(es| filing| return)|payroll|quickbooks|financial statements?)\b/i, name: "Accounting / bookkeeping / taxes", group: "C" },
  { re: /\b(legal|lawyer|attorney|contracts? (drafting|review)|business permit|dti registration|trademark registration)\b/i, name: "Legal work / permits", group: "C" },
  { re: /\b(hack(ing)? into|hack (my|our|their|his|her|an?|the|someone'?s?) ?\w* ?(account|page|profile|email|password|phone)|hacker|recover (my |our )?(hacked |old |lost )?(account|page|password|profile)|get (my|our) (account|page|profile) back|bypass (the )?(password|verification|login))\b/i, name: "Hacking / recovering accounts", group: "C", warn: true, todo: "Decline. Only the account owner can recover it through Facebook or Google's official help pages. Offer to send them the official recovery link." },
  { re: /\b(buy(ing)? (\w+ )?(followers|likes|views|reviews|subscribers)|fake (\w+ )?(reviews|followers|likes|accounts)|bot followers|boost (my |our )?followers)\b/i, name: "Fake followers / likes / reviews", group: "C", warn: true, todo: "Decline. Fake followers or reviews break Facebook, Google and TikTok rules and can get their page banned. Offer real growth instead: content, Reels, SEO or ads." },
  { re: /\b(on[- ]site|in[- ]person|photo ?shoot|video ?shoot|come to (our|my) (shop|store|office|event)|event coverage)\b/i, name: "On-site / in-person work or photoshoots", group: "C" },
  { re: /\b(game development|video game|blockchain|crypto|nft)\b/i, name: "Games / blockchain / crypto", group: "C" },
];

const GROUP = {
  A: { label: "Close to your services", emoji: "🟢", todo: "Say yes as a paid add-on. Quote it like your nearest service, in writing, with the 50% deposit." },
  B: { label: "New, but you can learn it", emoji: "🟡", todo: "Before you say yes, ask Claude for the steps. Then offer it with an honest timeline or a small first-project discount, or decline kindly." },
  C: { label: "Outside your services", emoji: "🔴", todo: "Decline politely and suggest a specialist. Offer what you do instead." },
};

// Fields that are about the client, not the request
const SKIP = new Set(["name", "email", "phone", "business", "website", "link", "links", "type", "form-name", "bot-field", "start_utc", "user_agent", "tz", "timezone", "payment_method", "amount", "reference"]);

/** Returns [{ name, group, label, emoji, todo, warn, quote, field }] (one per rule that matched). */
export function scopeCheck(data = {}) {
  const out = [];
  for (const rule of SCOPE_RULES) {
    for (const [k, v] of Object.entries(data)) {
      if (SKIP.has(k) || /^file_/.test(k) || typeof v !== "string" || !v) continue;
      const m = rule.re.exec(v);
      if (!m) continue;
      const i = m.index, start = Math.max(0, i - 40), end = Math.min(v.length, i + m[0].length + 40);
      const quote = (start ? "…" : "") + v.slice(start, end).replace(/\s+/g, " ").trim() + (end < v.length ? "…" : "");
      out.push({ name: rule.name, group: rule.group, ...GROUP[rule.group], ...(rule.todo ? { todo: rule.todo } : {}), warn: !!rule.warn, quote, field: k });
      break; // one hit per rule is enough
    }
  }
  return out.sort((a, b) => b.group.localeCompare(a.group)); // C first, then B, then A
}

export const KIT_URL = "https://claude.ai/artifact/8E7kS9BtnXJKM1bE4d7Pgp";
