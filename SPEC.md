# Price Tracker: MVP 1 spec

Source: Nasta's PRD "Smart Fashion Wishlist & Price Tracker". This file is the build brief for Claude Code.

## Goal
Save time. Finding the best price costs the user up to 10 hours a week. MVP 1 answers "where is this item cheapest right now?" for any item she finds.

## MVP 1 scope
1. Add an item: pasted link, typed name, or (later) shared screenshot.
2. Each item has several shop sources: shop, URL, price, currency, date the price was read.
3. Shops have a type: `public` (server can look up, e.g. Zalando, Answear, AboutYou) or `gated` (needs her login, e.g. Zalando Lounge, BestSecret). Gated shops show "not checked yet" until a price is typed in.
4. Discount codes: shop (or all), % or fixed amount, minimum order, valid from/to, can be combined (v1: only the best single code is applied).
5. Final price after the best valid code per source. Sources sorted from cheapest final price upward. Cheapest highlighted.
6. Each price shows its age ("2 days ago"). No background refresh.
7. Product card: photo, price, trend over time, available sizes, list of shops with prices (sorted cheapest first).
8. Optional target price per item, set by hand (no global rule). Badge "at or below target".
9. Mobile first, installable (PWA). Separate profiles per user (her mother may use it).

## Out of scope for MVP 1
Push notifications, wishlist sync, browser extension, automatic scraping, screenshot reading.

## Rules
- Czech UI text is fine later; code and UI labels in English for now.
- Prices stored with currency. Conversion to CZK is a TODO (PRD gap).
- Code rules: skipped when expired, minimum order not met, or shop does not match.
- Worked example: 6,138 CZK with a 22% code (min order 1,499) is 4,787.64 CZK.

## Open risk (verify first)
Whether the same item can be matched reliably across shops, and whether public shop pages can be read at all. Matching needs brand + name + colour; uncertain matches are marked "uncertain" and the user confirms.
