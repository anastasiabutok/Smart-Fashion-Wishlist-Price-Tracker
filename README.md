# Price Tracker (MVP 1)

Mobile-first web app (installable PWA) that compares one item across shops, applies your best discount code and sorts shops from cheapest. Spec: `SPEC.md`.

## Run
Requires Node 22.5+ (uses built-in `node:sqlite`, no npm install needed).

    npm start        # http://localhost:3000 (PORT, DB_PATH env vars optional)
    npm test

On a phone on the same Wi-Fi open `http://<computer-ip>:3000` and use "Add to Home Screen".

## Known limits (MVP 1)
- Paste a product link and the app tries to fill in name, brand, colour, sizes, price and photo (works on pages that expose standard product data, e.g. Zalando; may fail on shops that block automated requests, then fill in by hand). Shops needing a login (Zalando Lounge, BestSecret) cannot be read this way.
- Otherwise prices are entered by hand. No scraping, no background refresh, no push notifications yet.
- Profiles are a name, not a login: anyone who types the same name sees that profile. Add real auth before hosting it publicly.
- Prices are not converted between currencies; everything is treated as CZK.
- Only the single best discount code is applied (no stacking).
- Matching the same item across shops is manual (shop sources are attached by you).
