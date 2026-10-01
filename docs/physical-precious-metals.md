# Physical precious metals

Gold, silver, and platinum holdings track physical coins, bars, and rounds separately from cash accounts and exchange-traded securities. A holding records its name, storage notes, metal, display currency, quantity, weight per item, weight unit, weight basis, and purity. Use `g` or `troy_oz`: one troy ounce is exactly 31.1034768 grams. For gross weight, fine grams are gross grams multiplied by the purity fraction. For an explicitly fine weight, purity is descriptive and must not be applied again. Physical attributes and holding currency are fixed at creation so historical inventory and costs do not change when the name or storage notes are edited. The overview shows separate fine-weight totals for each metal; all three contribute to the same precious-metals net-worth bucket.

## Inventory and cost

Opening lots and purchases add inventory; sales consume lots in FIFO order by event date, then creation time and ID. Acquisition events snapshot fine grams per item. Purchase `totalAmount` is the all-in acquisition cost, including premiums and fees. Sale `totalAmount` is the net proceeds after fees. Record the final amount once to avoid double-counting fees. Opening lots can have unknown costs. Unknown cost remains unknown; it is not replaced with zero or a quote. Aggregate gain is unavailable when any required basis or currency conversion is missing. FIFO is a tracking convention here, not a tax determination.

Events cannot be dated in the future or create a negative inventory balance at any point in the ledger. Quantities and fine mass use decimal arithmetic, and monetary fields use the application's `Money` representation.

An event can link to one existing eligible cash transaction with the same owner, currency, direction, and amount. Imported bank transactions must be settled; pending or held payments cannot be linked until booked. Linking does not create another cash transaction or change the account balance; it identifies the cash flow as a transfer to or from physical metals. Opening events do not link cash. Unlink before editing or deleting a linked cash transaction. The same cash transaction cannot fund multiple tracked assets.

## Quotes and valuation

Each holding chooses automatic or manual pricing. Manual quotes are private to the holding, require their actual as-of date, and work without any provider credential. A pricing-mode history preserves the choice that applied at a historical valuation time. Quote selection never uses a later quote for an earlier valuation.

Value is `fine grams / 31.1034768 × price per fine troy ounce`. A missing quote yields an unavailable value, never a zero or the acquisition cost disguised as spot value. Quotes older than 72 hours are stale. Keep the last good quote after a provider failure and display its original as-of time. Spot-derived values are indicative melt values; dealer spreads, premiums, taxes, fees, and collectible value can change the amount actually received.

Currency conversion uses dated system USD exchange-rate observations on or before the valuation date. Cost-basis conversions use the acquisition date. Current manual FX overrides are excluded because their mutable storage does not preserve a historical revision record. Same-currency valuation needs no FX observation; missing cross-currency data remains an explicit incomplete value, with no 1:1 or future-rate fallback. Historical balances use dated events, dated quotes, and historical FX, rather than applying today's spot price to past holdings. Net worth counts metals separately from cash, portfolios, vehicles, and ventures. Incomplete history exposes unvalued holdings so missing data is visible.

## Automatic pricing configuration

Configure `PRECIOUS_METALS_PRICE_PROVIDER` in the **backend environment**:

| Setting                                          | Provider                                        | Credentials                   |
| ------------------------------------------------ | ----------------------------------------------- | ----------------------------- |
| `gold-api` (default, including an empty setting) | Gold-API.com current prices                     | None                          |
| `goldapi`                                        | Optional GoldAPI.io adapter, a separate service | Server-side `GOLDAPI_API_KEY` |
| `none`                                           | Manual pricing only                             | None                          |

`OFFLINE_MODE=true` disables automatic fetching for every provider. Unknown provider settings also disable fetching. Manual quotes remain available in every configuration. Optional credentials must never appear in frontend `VITE_*` configuration, browser requests, fixtures, logs, or committed files. This implementation does not register accounts or purchase plans.

The default, replaceable adapter uses the official current-price endpoint:

```http
GET https://api.gold-api.com/price/XAU/USD
Accept: application/json
```

Silver uses `XAG` and platinum uses `XPT`. The response must contain the requested `symbol`, `currency: "USD"`, a positive numeric `price`, and a valid zoned ISO `updatedAt` timestamp. Fixed HTTPS origins, disabled redirects, an eight-second timeout, and strict response validation constrain both adapters. Invalid or future timestamps are rejected. The upstream quotation time is preserved separately from local retrieval time. Errors exclude upstream bodies and credentials; failed responses cannot overwrite good quotes.

The adapter interprets XAU/XAG/XPT prices using the conventional spot unit, USD per **fine troy ounce**. The provider's own site labels the price only “Per Oz.”; its current API documentation does not explicitly define troy ounces or fineness. This is a documented valuation assumption, not a separately verified provider unit guarantee. No additional purity factor is applied to the quote.

One global quote stream per provider is shared by every user and holding. Gold, silver, and platinum are each refreshed at most once per 24 hours after a successful retrieval. A Redis lock coordinates batches, a shared request gate spaces Gold-API.com calls by at least 1,100 ms, and per-metal attempt gates enforce a one-hour failure backoff. Each batch makes at most one HTTP request per metal, with no transport retries. One metal's failure does not discard the others' successes. Redis failure skips fetching. Loading pages and clicking refresh cannot bypass the cache or backoff. Switching providers preserves all dated quotes and starts a separate cache for the selected source.

The backend checks on startup and at minute 20 of every hour in UTC; the job is disabled in test mode. The persisted 24-hour cache suppresses requests while retrievals remain fresh, so an expired quote is normally refreshed within the following hour. Baseline daily requests total at most **93 in a 31-day month** for three metals. Failures, switching providers, and rebuilding empty storage can add requests. A stale market timestamp remains stale even after a successful retrieval. No historical provider endpoint is called: history consists of the dated quotes actually observed or explicitly entered, with gaps left visible.

### Provider research, retrieved 2026-10-01

Gold-API.com was selected because its documented current gold/silver/platinum feed needs no account or key, and its terms explicitly permit use in commercial applications. Primary sources:

- [API docs](https://gold-api.com/docs) and the linked [full endpoint documentation](https://gold-api.com/llms.txt): `/price/{symbol}/{currency}`, XAU/XAG/XPT coverage, USD, `updatedAt`, no authentication for current prices, and a request to cache responses for at least 30 seconds. The application's daily cache exceeds that minimum.
- [Pricing](https://gold-api.com/pricing): the free plan advertises unlimited real-time price requests. Historical/OHLC access has a separate free limit of **10 requests/hour**, requires a key, and has paid upgrades; this feature does not use it.
- [Terms of service](https://gold-api.com/terms), effective September 10, 2026: §9 says commercial use is “always permitted,” including web/mobile applications and third-party sites. §4 prohibits abuse and warns that multiple requests per second can lead to an IP ban. “Unlimited” is therefore not permission to send bursts; the shared cache and pacing enforce conservative application usage.
- [Homepage](https://gold-api.com/) and [assets](https://gold-api.com/assets/): gold/silver/platinum support, “Per Oz.” labeling, and a provider claim of upstream-provider failover. That claim is not independent reliability evidence. Terms §§5–6 disclaim data accuracy, reliability, and uninterrupted availability; no SLA was established. Last-good quotes, visible timestamps/staleness, and manual pricing are the fallback.

These terms permit commercial application use; they do not establish an unrestricted right to resell raw datasets. Recheck published terms and limits when operating a deployment. Separate installations sharing an outbound IP must also coordinate their traffic. No Kitco scraping is used.

The optional **GoldAPI.io** adapter uses `https://www.goldapi.io/api/{XAU|XAG|XPT}/USD` with `x-access-token` and parses `metal`, `currency`, `price`, and Unix-second `timestamp`. Its [official HTTP client](https://github.com/goldapi-io/goldapi-mcp-server/blob/dd389e3f1e53b2bb68339aff71e3544278800cdd/src/services/goldApiClient.ts), [calculator](https://github.com/goldapi-io/goldapi-mcp-server/blob/dd389e3f1e53b2bb68339aff71e3544278800cdd/src/tools/calculateMetalValue.ts), [supported metals](https://github.com/goldapi-io/goldapi-mcp-server#supported-metals), and [Go example](https://github.com/goldapi-io/gold-api-examples-go/blob/bc8ce96d4a1e73ca36a255fd7ddac9dc6718d101/README.md) establish its transport, platinum coverage, and troy-ounce contract. Its current account limits, pricing, and commercial data-use terms were not verified; review those separately before selecting it. Gold-API.com terms do not apply to GoldAPI.io.

Regression tests use synthetic prices such as XAU 2000, XAG 25, and XPT 1000. They verify parsing, selection, caching, failures, and valuation arithmetic without live network dependencies.

An opt-in live smoke check on 2026-10-01 verified the production Gold-API.com gold adapter and authenticated valuation of a synthetic two-fine-troy-ounce holding, including source/timestamp preservation and cache reuse. The silver request and one bounded retry both encountered an environment proxy rejection, HTTP 403 “No approved upstream IPv4 address”; live silver remains unverified. The application preserved the good gold quote, kept silver's value unavailable, and honored the failure backoff. All temporary users, holdings, observed quotes, and isolated database/Redis resources were removed; the development instance remained offline. This one-time check does not establish provider uptime.

A subsequent live `XPT/USD` request on 2026-10-01 passed the production platinum adapter's schema and timestamp validation. The platinum browser flow was verified separately with synthetic quotes, purchases, a partial FIFO sale, and distinct metal totals at desktop and mobile widths. Its temporary data was removed after verification.

## Schema, backups, and rollback

Migration `20261001000000-create-precious-metals.ts` creates the physical-metal ledger, dated pricing-mode history, and quote storage. Global provider quotes have no user or holding owner; manual quotes belong to a user and holding. Backup and account deletion include the private ledger/manual data and preserve ownership boundaries. Shared market-feed quotes are excluded from individual user backups.

Apply migrations through the existing backend migration scripts. Use the migration's down direction only when prepared to remove the physical-metal records it owns; preserve a backup before a destructive rollback. The rollback restores the original classification of matched cash transactions before removing their metal links; it leaves their amounts and balances unchanged. This migration does not fabricate holdings, quotes, cash transactions, or historical market data.

The unmerged migration includes platinum in `precious_metals_physical_spec`. If an earlier version of this feature migration was already applied locally, the migration runner will not rerun it. Widen that local constraint without deleting holdings or rolling back the ledger:

```sql
BEGIN;
ALTER TABLE "PreciousMetalHoldings"
  DROP CONSTRAINT precious_metals_physical_spec;
ALTER TABLE "PreciousMetalHoldings"
  ADD CONSTRAINT precious_metals_physical_spec CHECK (
    metal IN ('gold', 'silver', 'platinum')
    AND form IN ('coin', 'bar', 'round')
    AND "weightUnit" IN ('g', 'troy_oz')
    AND "weightBasis" IN ('gross', 'fine')
    AND "weightPerItem" > 0 AND purity > 0 AND purity <= 1
    AND "pricingMode" IN ('automatic', 'manual')
  );
COMMIT;
```
