# PH Fuel Price Watch

A free, no-build static site that estimates the next Tuesday's pump price change (gasoline, diesel, kerosene) in the Philippines.
GitHub Actions fetches free market data, writes `data/forecast.json`, and publishes the site to GitHub Pages.

## How the estimate works
1. Takes daily closes of US RBOB (gasoline) and ULSD (diesel, kerosene) futures from Yahoo Finance, and USD/PHP from Frankfurter (ECB rates).
2. Converts each day to PHP per liter, averages Mon–Fri (US trade dates) for the driving week and the week before, takes the difference, and adds 12% VAT.
3. Once 6+ actual DOE adjustments are known (back-tested from the DOE's reports), it fits a correction factor and sizes the range from its real past error.
4. Optional: add a published industry estimate in `data/industry.json` and it is blended 50/50 with the model.

Singapore (MOPS) prices are what the Philippines actually follows, and they are not free. US futures are a proxy, so expect misses, especially at first.

## Deploy to GitHub Pages
1. Create a new **public** repository on GitHub (e.g. `ph-fuel-price-watch`).
2. Upload everything in this folder (keep `.github/workflows/update.yml`), or:
   `git init && git add . && git commit -m "Initial commit" && git branch -M main && git remote add origin https://github.com/YOUR-USER/ph-fuel-price-watch.git && git push -u origin main`
3. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Repo **Settings → Actions → General → Workflow permissions: Read and write permissions** → Save.
5. Repo **Actions** tab → **Update forecast and deploy** → **Run workflow**. Wait for both jobs to turn green.
6. Open `https://YOUR-USER.github.io/ph-fuel-price-watch/`.

After that it refreshes itself Monday to Saturday at 06:30 PHT. If GitHub pauses the schedule after a quiet stretch, press **Enable workflow** in the Actions tab.

## Actual adjustments are recorded automatically
Each run reads two DOE publications. Neither ever overwrites values you entered by hand.

1. **Prior Notice on Price Adjustments** (https://doe.gov.ph/data-and-prices/liquid-fuels/retail-pump-prices/price-adjustments): one row per oil company, posted before the Tuesday. A fuel is recorded only when at least 3 companies filed and at least 60% agree on the number. These entries are marked provisional.
2. **Oil Monitor** (https://doe.gov.ph/data-and-prices/liquid-fuels/oil-monitor): every report states the year-to-date net change. This week's total minus last week's total is the official actual, and it replaces the provisional value.

- The first run backfills recent weeks and back-tests the model on them, so calibration starts immediately. Back-tested rows are marked `*` on the page.
- If a report can't be read or doesn't line up, that week is skipped rather than guessed, and the page shows a note when both sources fail.

**Optional manual override** (a skipped week or a correction): **Actions** tab → **Update forecast and deploy** → **Run workflow**, fill in the fuels you have (rollback is negative, e.g. `-0.50`; leave `date` as `auto` for the most recent Tuesday). Or edit `data/actuals.json` directly.

## Using a published (Singapore-based) estimate
Pump prices follow Singapore (MOPS) prices, which US futures only approximate. If you trust a published forecast, add it to `data/industry.json` under the target Tuesday (a number or a `[low, high]` range per fuel). The forecast blends it 50/50 with the market model and the page shows both numbers. The values are also saved in `data/forecast-log.json`, so you can later compare how each source did.

## Known limits
- Back-test (Sep to Nov 2026): diesel tracks well (9 of 9 directions right, typical miss about 2 pesos), gasoline reacts too little to very large moves, and kerosene is the weakest because there is no free kerosene benchmark. Ranges on the page reflect these real misses.
- Futures contracts roll at month end, which can create a false jump. When a roll falls between the two weeks being compared, the page says so and confidence is set to low.
- Early-week estimates (1 or 2 trading days) move a lot. Compare again on Friday.

## Local use
    npm test          # model tests
    npm run update    # fetch data and regenerate data/*.json (needs pdftotext: apt install poppler-utils / brew install poppler)
    npm run serve     # preview at http://localhost:3000

## Files
- `index.html`, `assets/` – the page
- `data/forecast.json` – what the page reads (generated)
- `data/market.json` – cached price series, used if a source is down (generated)
- `data/forecast-log.json` – every forecast made, so it can be compared with actuals (generated)
- `data/actuals.json` – actual adjustments (filled automatically from DOE; you can edit)
- `data/ytd.json`, `data/notices.json` – DOE reports already read (generated)
- `data/industry.json` – optional industry estimates (you maintain)
- `scripts/model.mjs` – forecasting math · `scripts/update.mjs` – data + forecast · `scripts/doe.mjs` – DOE Oil Monitor reader · `scripts/add-actual.mjs` – helper · `scripts/test.mjs`
- `.github/workflows/update.yml` – schedule + deploy
