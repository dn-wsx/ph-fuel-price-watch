# PH Fuel Price Watch

https://dn-wsx.github.io/ph-fuel-price-watch/

A free, no-build static site that estimates the next Tuesday's pump price change (gasoline, diesel, kerosene) in the Philippines.
GitHub Actions fetches free market data, writes `data/forecast.json`, and publishes the site to GitHub Pages.

## How the estimate works

1. Takes daily closes of US RBOB (gasoline) and ULSD (diesel, kerosene) futures from Yahoo Finance, and USD/PHP from Frankfurter (ECB rates).
2. Converts each day to PHP per liter, averages Mon–Fri for the driving week and the week before, takes the difference, and adds 12% VAT.
3. Once 6+ actual DOE adjustments are recorded, it fits a correction factor and sizes the range from its real past error.
4. Optional: add a published industry estimate in `data/industry.json` and it is blended 50/50 with the model.

Singapore (MOPS) prices are what the Philippines actually follows, and they are not free. US futures are a proxy, so expect misses, especially at first.

<!-- ## Deploy to GitHub Pages

1. Create a new **public** repository on GitHub (e.g. `ph-fuel-price-watch`).
2. Upload everything in this folder (keep `.github/workflows/update.yml`), or:
   `git init && git add . && git commit -m "Initial commit" && git branch -M main && git remote add origin https://github.com/dn-wsx/ph-fuel-price-watch.git && git push -u origin main`
3. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Repo **Settings → Actions → General → Workflow permissions: Read and write permissions** → Save.
5. Repo **Actions** tab → **Update forecast and deploy** → **Run workflow**. Wait for both jobs to turn green.
6. Open `https://YOUR-USER.github.io/ph-fuel-price-watch/`.

After that it refreshes itself Monday to Saturday at 06:30 PHT. If GitHub pauses the schedule after a quiet stretch, press **Enable workflow** in the Actions tab.

## Record the actual Tuesday adjustment (this is what makes it accurate)

On Tuesday or Wednesday, add what the DOE/oil companies announced (negative = rollback):

    node scripts/add-actual.mjs 2026-11-17 gasoline=1.20 diesel=-0.50 kerosene=-0.30

Or edit `data/actuals.json` directly on github.com. Commit, and the next run picks it up. No local setup is needed if you use the web editor.

## Local use

    npm test          # model tests
    npm run update    # fetch data and regenerate data/*.json
    npm run serve     # preview at http://localhost:3000

## Files

- `index.html`, `assets/` – the page
- `data/forecast.json` – what the page reads (generated)
- `data/market.json` – cached price series, used if a source is down (generated)
- `data/forecast-log.json` – every forecast made, so it can be compared with actuals (generated)
- `data/actuals.json` – actual adjustments (you maintain)
- `data/industry.json` – optional industry estimates (you maintain)
- `scripts/model.mjs` – forecasting math · `scripts/update.mjs` – data + forecast · `scripts/add-actual.mjs` – helper · `scripts/test.mjs`
- `.github/workflows/update.yml` – schedule + deploy -->
