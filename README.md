# PH Fuel Price Watch

A free, no-build static site that estimates the next Tuesday's pump price change (gasoline, diesel, kerosene) in the Philippines.
GitHub Actions fetches free market data, writes `data/forecast.json`, and publishes the site to GitHub Pages.

## How the estimate works
Pump prices follow the average Singapore (MOPS) price of each product from Monday to Friday, against the week before, converted at the peso rate, plus 12% VAT. The only unknown is the Singapore price, which is not free, except for one source:

**Korea's Opinet (KNOC) publishes the daily Singapore (Platts-based) price of each product** in USD/bbl, back to 2008, the day after (Tuesday to Saturday): https://www.opinet.co.kr/glopopdSelect.do. The updater reads gasoline RON 92, diesel 0.001%S and kerosene from that table, and USD/PHP from Frankfurter (ECB, which matched the BSP weekly average quoted by the DOE to within P0.04 over 17 weeks). Days Singapore's market is closed are skipped.

- **It is the data the DOE uses.** The Oil Monitor's weekly change in "international" gasoline and diesel prices equals the change in Opinet's 92RON and 0.001%S columns to within US$0.1/bbl over 16 weeks (Jul-Nov 2026). The 95RON and 0.05%S columns differ by up to US$0.7.
- **It reproduces the actual adjustments.** Over the 12 weeks of announced DOE adjustments from Aug to Nov 2026 the Mon-Fri average missed by P0.86/L (gasoline), P0.65 (diesel) and P0.61 (kerosene), with the direction right 12 of 12 times for every fuel. The DOE's own USD figures miss by about P0.6 to 0.9, so this is close to the limit. The old US-futures proxy missed by about P3.0, P1.3 and P1.9. The page shows these numbers under "Forecast vs. actual".
- **Day by day.** The average miss against the final adjustment is about P1.9 after trading day 1, P1.2 to 1.6 after day 2, P0.9 to 1.3 after day 3 and P0.6 to 1.0 by days 4 and 5. Days still to come are held at the latest price, and the range widens for them. Day 1 is the first Singapore trading day: Monday 9 Nov 2026 was a Singapore holiday, so Day 1 was Tuesday 10 Nov.
- **Calibration.** Once 6+ actual DOE adjustments are known, a correction scale (robust to one freak week, pulled toward 1) is fitted; it comes out at about 1.0, which confirms the structure. The range comes from the real past error.
- **Fallback.** If Opinet cannot be read (and nothing is saved), the page says so and uses US futures (Brent/RBOB for gasoline, NY ULSD for diesel and kerosene), which miss Asian moves. Month-end contract rolls in those futures are neutralised by reading the same contract on both sides.
- **News cross-check.** Outlets publish an industry estimate from Thursday to Saturday. The updater reads them from Google News headlines (only when two agree) and shows them beside the number. They are built on the same Singapore prices, so they never change it: on the Friday of the 10 Nov week the model said P12.2 for gasoline and the news P13.

The limits: Opinet posts day T on day T+1, so the model trails same-day posts by about half a day. Measured, that costs almost nothing (a same-day nowcast from Singapore-close-aligned futures changed the weekly miss by about 5%, within noise), because the main uncertainty early in the week is the days that have not happened yet. The remaining miss is the oil companies' own rounding and discretion: the week of 10 Nov 2026 gasoline was cut by P16.80 where the Singapore price implied P11.9.

## Everything runs by itself
GitHub Actions runs it Monday to Saturday at 06:30 PHT and Tuesday to Saturday at 12:00 and 18:30 PHT. Each run reads Opinet, Yahoo, Frankfurter, the DOE's Prior Notice and Oil Monitor reports and the news; records new actual adjustments; refits the calibration; rewrites `data/forecast.json`; and republishes the page. Nothing needs to be typed in. If an update stops, the page shows a warning. GitHub can delay scheduled runs by hours, and may pause them after 60 days without repository activity (press **Enable workflow** in the Actions tab). The updater records when Opinet first shows each new day in `data/market.json` (`opinetSeen`), so the schedule can be tuned from facts.

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

## Free sources checked for Singapore (MOPS) prices
- **Used: Korea Opinet** public page (above). Free, no key, one form POST per run, plain HTTP. It is a public page, not an API, so it can change; it is a government site, so keep the load light (the updater makes one request per run).
- **Tested and not used:** TradingView's unofficial chart socket serves CME Singapore swap futures (Mogas 92, Gasoil, Jet Kerosene). They are unofficial and thin, missed gasoline by P1.55/L (Opinet: P0.86) and track Singapore's daily moves only loosely. Yahoo's hourly futures aligned to Singapore's close track diesel and kerosene moves well (correlation about 0.8) but add nothing measurable to the weekly estimate.
- **Not usable:** Yahoo daily data alone (no Singapore or ICE gasoil symbols), EIA (no Singapore series), CME, ICE, Barchart and Investing.com (block scripted access), Stooq (proof-of-work challenge), TradingEconomics (guest key gone), IndexMundi (monthly world averages), India PPAC (PDF only), AIP Australia (chart data behind JavaScript), Facebook (not machine-readable). The DOE Oil Monitor states the weekly change in Singapore gasoline and diesel, but only on the Tuesday.

## Known limits
- Early-week estimates (1 or 2 trading days) move a lot. The range says how much. Compare again on Friday.
- Freak weeks happen: the oil companies do not always pass the Singapore change through one for one. The model's misses do not carry over from week to week, so they cannot be corrected for.
- The US-futures fallback needs the front contract saved to handle month-end rolls. Contracts are saved from now on, so fallback back-tests across an older roll are skipped, not guessed.
- Opinet's layout or access could change. The page then falls back to US futures and says so.

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
- `scripts/model.mjs` – forecasting math · `scripts/market.mjs` – Opinet, Yahoo and FX data · `scripts/news.mjs` – news cross-check · `scripts/update.mjs` – data + forecast · `scripts/doe.mjs` – DOE Oil Monitor reader · `scripts/add-actual.mjs` – helper · `scripts/test.mjs`
- `.github/workflows/update.yml` – schedule + deploy
