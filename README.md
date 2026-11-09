# Price Tracker (MVP 1)

Mobile-first web app (installable PWA) that compares one item across shops, applies your best discount code and sorts shops from cheapest. Spec: `SPEC.md`.

## Run
Requires Node 22.5+ (uses built-in `node:sqlite`, no npm install needed).

    npm start        # http://localhost:3000 (PORT, DB_PATH env vars optional)
    npm test

On a phone on the same Wi-Fi open `http://<computer-ip>:3000` and use "Add to Home Screen".

## Known limits (MVP 1)
- Paste a product link and the app tries to fill in name, brand, colour, sizes, price and photo (works on pages that expose standard product data, e.g. Zalando; may fail on shops that block automated requests, then fill in by hand). Shops needing a login (Zalando Lounge, BestSecret) cannot be read this way.
- Import page: paste many links at once, each becomes an item.
- On an item, paste a link from another shop to add it as a source; the price is read, and the match is flagged "uncertain" if brand, name or colour differ. Search links per shop are provided (Google site search), the app does not search shops by itself.
- Otherwise prices are entered by hand. No scraping, no background refresh, no push notifications yet.
- Profiles are a name, not a login: anyone who types the same name sees that profile. Add real auth before hosting it publicly.
- A link priced in another currency (e.g. Shopbop in USD) is converted to CZK once, when added, at the Czech National Bank's daily rate. Shipping, customs and card fees are not included. If no rate is available the price is left for you to enter by hand. Prices typed by hand are treated as CZK.
- Only the single best discount code is applied (no stacking).
- Matching the same item across shops is manual (shop sources are attached by you).
