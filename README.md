# PH Fuel Price Watch

A free, no-build static site that estimates the next Tuesday's pump price change (gasoline, diesel, kerosene) in the Philippines.
GitHub Actions fetches free market data, writes `data/forecast.json`, and publishes the site to GitHub Pages.

## How the estimate works
Pump prices follow the average Singapore (MOPS) price of each product from Monday to Friday, against the week before, converted at the peso rate, plus 12% VAT. Checked against the DOE's own weekly figures, this arithmetic reproduces the announced adjustments with a typical miss under P0.9/L. The only unknown is the Singapore price, which is not free. So:

1. **Singapore price model (always runs).** Korea's Opinet (KNOC) publishes the daily Singapore (Platts-based) price of each product in USD/bbl, back to 2008, the day after (Tuesday to Saturday): https://www.opinet.co.kr/glopopdSelect.do. The updater reads gasoline RON 95, diesel 0.05%S and kerosene from that table, and USD/PHP from Frankfurter (ECB, which matched the BSP weekly average quoted by the DOE to within P0.04 over 17 weeks). Days Singapore's market is closed are skipped. Day 1 of the week is the first Singapore trading day, which is why the FB post of 10 Nov 2026 said "Day 1 (Nov 10)": Monday 9 Nov was a Singapore holiday (Deepavali).
   - **It reproduces the FB pages.** For Day 1 of the week of 17 Nov the table gave gasoline -4.71, diesel -6.43 and kerosene -7.22 per liter, against the posted -4.70, -6.40 and -6.90.
   - **It reproduces the actual adjustments.** Over the 12 weeks of DOE adjustments from Aug to Nov 2026 the Mon-Fri average missed by P1.05/L (gasoline), P0.83 (diesel) and P0.61 (kerosene), with the direction right 12 of 12 times for every fuel. The DOE's own USD figures miss by about P0.6 to 0.9, so this is close to the limit. The week of 10 Nov 2026 is the outlier (gasoline P11.6 estimated against P16.80 announced).
   - **Rest of the week held at the latest price.** Days still to come are projected at the newest price (the unbiased guess for a random walk), and the range widens for them.
   - **Calibration.** Once 6+ actual DOE adjustments are known, a correction scale (robust to one freak week, pulled toward 1) is fitted, and the range comes from the real past error.
   - **Fallback.** If Opinet cannot be read (and nothing is saved), the page says so and uses US futures (Brent/RBOB for gasoline, NY ULSD for diesel and kerosene), which miss Asian moves: about P3.0, P1.3 and P1.9 on the same 12 weeks. Roll jumps in those monthly contracts are neutralised by reading the same contract on both sides.
2. **Published estimates (when available, 90% weight).** The Facebook oil-price pages and the news publish an estimate on the real Singapore prices every day ("world market trading Day 1..."). Add one by hand (below), or the updater reads estimates from news headlines on its own (70% weight, and only when two headlines agree). A published estimate removes most of the model's own error from the range.

Singapore products can move far differently from US futures: in the week of 10 Nov 2026 gasoline was cut by P16.80/L, 3 to 4 times what Brent and RBOB implied, which is why Opinet's Singapore prices replaced them. The one limit is timing. Opinet posts day T on day T+1, so the model trails the FB pages by about half a day. A published estimate you add by hand closes that gap.

## Deploy to GitHub Pages
1. Create a new **public** repository on GitHub (e.g. `ph-fuel-price-watch`).
2. Upload everything in this folder (keep `.github/workflows/update.yml`), or:
   `git init && git add . && git commit -m "Initial commit" && git branch -M main && git remote add origin https://github.com/YOUR-USER/ph-fuel-price-watch.git && git push -u origin main`
3. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Repo **Settings → Actions → General → Workflow permissions: Read and write permissions** → Save.
5. Repo **Actions** tab → **Update forecast and deploy** → **Run workflow**. Wait for both jobs to turn green.
6. Open `https://YOUR-USER.github.io/ph-fuel-price-watch/`.

After that it refreshes itself Monday to Saturday at 06:30 PHT, and Tuesday to Saturday at 12:00 and 18:30 PHT (once Opinet has posted the previous Singapore day). If GitHub pauses the schedule after a quiet stretch, press **Enable workflow** in the Actions tab.

## Actual adjustments are recorded automatically
Each run reads two DOE publications. Neither ever overwrites values you entered by hand.

1. **Prior Notice on Price Adjustments** (https://doe.gov.ph/data-and-prices/liquid-fuels/retail-pump-prices/price-adjustments): one row per oil company, posted before the Tuesday. A fuel is recorded only when at least 3 companies filed and at least 60% agree on the number. These entries are marked provisional.
2. **Oil Monitor** (https://doe.gov.ph/data-and-prices/liquid-fuels/oil-monitor): every report states the year-to-date net change. This week's total minus last week's total is the official actual, and it replaces the provisional value.

- The first run backfills recent weeks and back-tests the model on them, so calibration starts immediately. Back-tested rows are marked `*` on the page.
- If a report can't be read or doesn't line up, that week is skipped rather than guessed, and the page shows a note when both sources fail.

**Optional manual override** (a skipped week or a correction): **Actions** tab → **Update forecast and deploy** → **Run workflow**, fill in the fuels you have (rollback is negative, e.g. `-0.50`; leave `date` as `auto` for the most recent Tuesday). Or edit `data/actuals.json` directly.

## Adding a published estimate (the FB pages)
Easiest, also from the GitHub phone app: **Actions → Update forecast and deploy → Run workflow**, fill in the **PUBLISHED ESTIMATE** fields (rollback is negative, e.g. `-4.70`; leave the date as `auto` for the next Tuesday; put the page and trading day in the source) and run it. The page updates in about a minute and shows the model and the published number side by side.

Or locally: `node scripts/add-estimate.mjs auto gasoline=-4.70 diesel=-6.40 kerosene=-6.90 source="FB page, trading Day 1"` (a range is written `diesel=-6.9:-6.4`), or edit `data/industry.json` by hand. The values are saved in `data/forecast-log.json`, so you can later compare how each source did. Update it each day as the page posts Day 2, 3, 4: the estimate is only as fresh as what you enter.

**News headlines (automatic).** Each run reads a Google News RSS search for rollback/hike headlines, keeps only forecasts (Thursday to Saturday, or "next week" wording), parses fuel and amount (`Gasoline may plunge by P14/L`, `P13 for gas, P4 for diesel`, `P2 to P3`), and uses a fuel only when at least two headlines agree within P1.50. Estimates are saved in `data/news.json`. Headlines that say "up to P14" without naming a fuel are ignored.

## Free sources checked for Singapore (MOPS) prices
- **Used: Korea Opinet** public page (above). Free, no key, one form POST per run, plain HTTP. It is a public page, not an API, so it can change; it is a government site, so keep the load light (the updater makes one request per run).
- **TradingView's unofficial chart socket** serves CME Singapore swap futures (Mogas 92, Gasoil, Jet Kerosene) and was tested, but it is unofficial and thinly traded. Against the actual adjustments it missed gasoline by P1.55/L (Opinet: P1.05) and its day-to-day moves track Singapore's only loosely (correlation about 0.4), so it is not used.
- **Not usable:** Yahoo (no Singapore or ICE gasoil symbols), EIA (no Singapore series), CME, ICE, Barchart and Investing.com (block scripted access), Stooq (proof-of-work challenge), TradingEconomics (guest key gone), IndexMundi (monthly world averages), India PPAC (PDF only), AIP Australia (chart data behind JavaScript), Facebook (not machine-readable). The DOE Oil Monitor states the week-on-week change in Singapore gasoline and diesel, but only on the Tuesday.

## Known limits
- Without a published estimate the page shows the model alone, which trails the FB pages by about half a day because Opinet posts a day late.
- Early-week estimates (1 or 2 trading days) move a lot. Compare again on Friday.
- The US-futures fallback needs the front contract saved to handle month-end rolls. Contracts are saved from now on, so fallback back-tests across an older roll are skipped, not guessed.
- Published estimates in headlines are rounded or "up to" figures. The hand-entered ones are better.

## Local use
    npm test          # model, market-data and news-parser tests
    npm run update    # fetch data and regenerate data/*.json (needs pdftotext: apt install poppler-utils / brew install poppler)
    npm run serve     # preview at http://localhost:3000

## Files
- `index.html`, `assets/` – the page
- `data/forecast.json` – what the page reads (generated)
- `data/market.json` – cached price series, used if a source is down (generated)
- `data/forecast-log.json` – every forecast made, so it can be compared with actuals (generated)
- `data/actuals.json` – actual adjustments (filled automatically from DOE; you can edit)
- `data/ytd.json`, `data/notices.json` – DOE reports already read (generated)
- `data/news.json` – estimates read from news headlines (generated)
- `data/industry.json` – published estimates you add (by form, script or by hand)
- `scripts/model.mjs` – forecasting math · `scripts/market.mjs` – Opinet, Yahoo and FX data · `scripts/news.mjs` – headline estimates · `scripts/update.mjs` – data + forecast · `scripts/doe.mjs` – DOE Oil Monitor reader · `scripts/add-actual.mjs`, `scripts/add-estimate.mjs` – helpers · `scripts/test.mjs`
- `.github/workflows/update.yml` – schedule + deploy
