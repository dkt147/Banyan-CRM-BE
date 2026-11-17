/*
 * List the Stripe account's Payment Links and print the STRIPE_PAYMENT_LINK_PRODUCTS value for
 * the website day passes. Read-only. Uses STRIPE_SECRET_KEY from .env.
 *
 *   npm run stripe:payment-links
 */
import "dotenv/config";

// Website buttons (banyanworkspace.com day-pass pages) → product key.
const WEBSITE_LINKS = {
  "https://buy.stripe.com/bIY03M8fMada9AkbJA": "half_day_pass",
  "https://buy.stripe.com/3cs6sa3Zwclih2MfZR": "day_pass",
  "https://buy.stripe.com/6oE17Q53A9969Ak6pi": "day_pass_10",
};

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY is not set.");
  process.exit(1);
}
const links = [];
let startingAfter = null;
do {
  const url = new URL("https://api.stripe.com/v1/payment_links");
  url.searchParams.set("limit", "100");
  if (startingAfter) url.searchParams.set("starting_after", startingAfter);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  const json = await res.json();
  if (!res.ok) {
    console.error(`Stripe error ${res.status}: ${json?.error?.message || ""}`);
    process.exit(1);
  }
  links.push(...json.data);
  startingAfter = json.has_more ? json.data.at(-1).id : null;
} while (startingAfter);

console.log(`Mode: ${key.startsWith("sk_live") || key.startsWith("rk_live") ? "LIVE" : "TEST"} · ${links.length} payment link(s)\n`);
const map = {};
for (const link of links) {
  const product = WEBSITE_LINKS[link.url];
  if (product) map[link.id] = product;
  console.log(`${link.id}  ${link.active ? "active  " : "inactive"}  ${link.url}${product ? `  → ${product}` : ""}`);
}
const missing = Object.entries(WEBSITE_LINKS).filter(([url]) => !links.some((l) => l.url === url));
if (missing.length) console.log(`\nNot found in this account: ${missing.map(([u, p]) => `${p} (${u})`).join(", ")}`);
console.log(`\nSet this on the server:\nSTRIPE_PAYMENT_LINK_PRODUCTS='${JSON.stringify(map)}'`);
