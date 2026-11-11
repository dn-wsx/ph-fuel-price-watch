# PH Fuel Price Watch

An estimate of next Tuesday's pump price change in the Philippines (gasoline, diesel and kerosene), updated automatically every day. It is free, needs no sign-up, and shows how close past estimates came to what the DOE announced.

**Live site: https://dn-wsx.github.io/ph-fuel-price-watch/**

## What you see on the page
- **The estimate**, in pesos per liter, for each fuel. Negative and green is a rollback. Positive and red is a hike.
- **Typical range.** Allows for historical errors and trading days still to come. It is not a calibrated probability interval or a guarantee.
- **Trading days.** "Based on 2 of 5 trading days" tells you how much of the week's Singapore trading has been seen so far.
- **Confidence** (low, medium, high), based on how many days have been seen and how much history there is.
- **News cross-check.** From about Thursday, news outlets publish their own estimates. They are listed beside ours for comparison and are not used in our number.
- **Forecast vs. actual.** For each past Tuesday: our forecast, the announced adjustment, and the miss. Green is within ₱1, amber is ₱1 to ₱2.50, red is more. Rows marked with * were rebuilt afterwards from that week's finished data. Provisional actuals are clearly labelled and do not influence calibration or confirmed accuracy scores.
- **How the live forecasts did.** Timestamped forecasts are kept without overwriting earlier runs. A later update checks which saved forecast is actually visible on the public page. Only forecasts observed there before Tuesday midnight PHT count toward live accuracy, once confirmed actuals arrive. Each fuel has its own sample count, average miss, bias, direction score and range coverage. Older snapshots without proof of publication are not counted.

## Why the price moves on Tuesdays
Oil companies adjust pump prices every Tuesday. The change follows the average Singapore (MOPS) price of each product from Monday to Friday of the week before, compared with the week before that, converted to pesos, plus 12% VAT. So the estimate gets firmer as the week goes on. Until Friday, days that have not happened yet are assumed to stay at the latest price, and the range allows for that.

## Where the numbers come from
- **Singapore product prices:** [Opinet (KNOC)](https://www.opinet.co.kr/glopopdSelect.do), listing gasoline (RON 92), diesel (0.001%S) and kerosene with a publication delay. This is a public website, not a guaranteed API or licensed MOPS feed.
- **Exchange rate:** [Frankfurter](https://frankfurter.dev/), using ECB reference rates rather than an oil company's actual exchange costs.
- **Actual adjustments:** [DOE company filings](https://doe.gov.ph/data-and-prices/liquid-fuels/retail-pump-prices/price-adjustments) and the [Oil Monitor](https://doe.gov.ph/data-and-prices/liquid-fuels/oil-monitor). Exact Monday/Tuesday announcements reported by at least two distinct supported news publishers can supply provisional figures while waiting for DOE confirmation. Forecasts, ranges and conflicting announcements are rejected. This conservative check may find no usable announcement.
- **News cross-check:** headlines found through [Google News](https://news.google.com/search?q=Philippines%20fuel%20price%20adjustment); forecasts never change the model's number.
- **Backup:** when Singapore prices are missing, the page says so and uses [US futures via Yahoo Finance](https://finance.yahoo.com/markets/commodities/), with a range calibrated on that source's own history. They can miss Asian market moves.
- **Source roles:** Opinet is the source of Singapore product prices; DOE is the source of announced Philippine adjustments. Both are kept as reported. An optional comparison of international-price changes is available under "What is driving it", but differences do not trigger failures or change the forecast. A report whose dates cannot be aligned is not compared.

## How accurate is it
See the [current accuracy tables on the live site](https://dn-wsx.github.io/ph-fuel-price-watch/#h-hist). They update with each successful run rather than relying on fixed figures here.

The site separates retrospective results rebuilt from finished data from verified public forecasts. It also shows a historical walk-forward check: each week's calibration uses earlier confirmed adjustments only. Historical market series can be revised, so this is not a substitute for the live record. Provisional actuals are excluded until confirmed. Small samples and a correct direction do not establish reliable future accuracy.

Public Singapore prices, exchange rates and the model's assumptions do not explain every pump adjustment. A large miss needs investigation; it is not proof of company discretion or a known source of error.

## When it updates
The intended update times (Philippine time) are:
- **6:17 AM**, Monday to Saturday
- **11:43 AM, 3:17 PM and 6:43 PM**, Tuesday to Saturday

GitHub is asked to start a lightweight check every half hour, at :17 and :47, from **6:17 AM to 8:47 PM, Monday to Saturday**.
The check reads the forecast currently visible on the public site. If its generation time covers the latest intended update
slot, the full fetch, calculation, health check and deployment are skipped. Otherwise, one current update catches up;
missed slots are not replayed as historical forecasts. The 11:43 AM and 6:43 PM slots normally become eligible at the :47 check.
Manual runs and code pushes still request an immediate update.

GitHub can delay or drop scheduled runs. Each full update fetches available data and recalculates, but repeated updates do not necessarily bring a new trading-day observation. Opinet generally publishes the previous Singapore trading day; DOE reports and news update only when their publishers add material. Publication lag can matter during large market moves. Before the new week's Singapore prices arrive, the page may use US futures and says so. If updates stop, the page shows a warning.

The four intended update slots are retained while publication-time observations accumulate. Later checks can recover an
isolated missed run or failed deployment, but cannot wake themselves up during a GitHub scheduler outage. An unreadable or
invalid public forecast produces a logged warning and allows a full update rather than incorrectly skipping it.

Temporary request failures get up to three total attempts, with short waits between attempts. Time limits prevent a slow source from holding the update indefinitely. After unsuccessful attempts, usable saved data is retained and a warning is shown; the next full update tries again. Publishing with cached data still covers that update slot. No additional monitoring service, server or database is used. Retries cannot recover a scheduled run that GitHub never starts.

## Limits
- This is an estimate from public data, not an official figure. Always check announcements from the DOE and your oil company.
- Early-week numbers move a lot. Check again on Friday.
- The page depends on Opinet's public page. If it changes or stops working, the page falls back to US futures and says so.
- Pump prices at individual stations can differ from the announced adjustment.

<!--
NOTES FOR THE SITE OWNER (hidden on the GitHub page)

Deploy to GitHub Pages
1. Create a public repository, for example ph-fuel-price-watch.
2. Upload everything in this folder, keeping .github/workflows/update.yml.
3. Settings → Pages → Build and deployment → Source: GitHub Actions.
4. Settings → Actions → General → Workflow permissions: Read and write permissions.
5. Actions tab → "Update forecast and deploy" → Run workflow. Wait for both jobs to turn green.
6. Open https://YOUR-USER.github.io/ph-fuel-price-watch/

Schedule
The workflow requests half-hourly wakeups (see .github/workflows/update.yml), at odd minutes because GitHub delays or drops runs
at the top of the hour. scripts/schedule.mjs compares the public forecast's generatedAt with the latest same-day PHT slot.
The public page is the persistent checkpoint, so committing data without successfully publishing it does not satisfy a slot.
No new state file, database, token or monitoring service is needed. Check-only runs still consume Actions resources.
GitHub may also pause scheduled runs after 60 days without repository activity. If that
happens, press "Enable workflow" in the Actions tab.
data/market.json records when Opinet first showed each new Singapore day (opinetSeen: the run before it, "after", and the run
that saw it, "by"). Once a few weeks of that exist, drop the runs that never catch anything new.

Alerts
The "health" job runs scripts/health.mjs after each update and fails the run when Opinet cannot be read, Singapore prices stop
for more than 5 days, no forecast is produced, or both DOE listings cannot be read. Source-comparison differences are informational,
not failures. GitHub notifications depend on the owner's settings (Settings → Notifications → Actions); delivery is not guaranteed.
There is no independent missed-run alert. The page warns readers when generated data is stale.

Request limits
scripts/http.mjs bounds the entire request including reading the body. Prices/headlines/listings: 25 seconds per attempt;
PDFs: 45 seconds. Up to 3 total attempts for transient network failures, 408, 429 and selected 5xx statuses.
Permanent HTTP errors and parser failures are not retried. PDF conversion is limited to 15 seconds. The DOE batch shares a
90-second budget; all upstream requests share a 4-minute budget. The updater process and workflow step are limited to
5 minutes, and the update job to 10. Exhaustion retains cached sources where possible, with explicit source notes.

Live track record
Each run appends an immutable record under data/forecast-log.json → target → records: model version, full fuel estimates and
ranges, stage, basis and source dates. Legacy snapshots are retained but are not proof of publication.
The next updater reads the existing public forecast and marks an exact matching record with publishedObservedAt.
This proves visibility by the observation time, not the original deployment time. A record not observed before Tuesday
00:00 PHT is excluded from scoring, even if it might have been published earlier. No external monitoring or callback is needed.
scripts/records.mjs computes per-fuel scores and chronological calibration checks; no future actuals train an earlier forecast.

Actual adjustments
Each run reads corroborated announcement headlines and two DOE publications. Provenance is stored per fuel:
- Exact, agreeing announcements from at least two supported publisher domains can create provisional actuals after the effective Tuesday arrives.
- Prior Notice on Price Adjustments (doe.gov.ph, retail pump prices, price adjustments): one row per oil company, posted before
  the Tuesday. A fuel is recorded only when at least 3 companies filed and at least 60% agree. Marked provisional.
- Oil Monitor (doe.gov.ph, oil monitor): each report states the year-to-date net change. This week's total minus last week's
  total is the official actual and replaces the provisional value.
If a report cannot be read or does not line up, that week is skipped rather than guessed.
Manual overrides are protected per fuel. Oil Monitor figures replace provisional values; company filings take priority over news.
Provisional actuals are excluded from calibration and confirmed accuracy, without excluding another confirmed fuel in the same row.
The two latest Oil Monitor PDFs are rechecked at most once per calendar day; SHA-256 hashes identify changed documents.
Revised official figures replace prior official figures, never manual overrides. Parsed report metadata is kept in
data/benchmarks.json; unreadable revisions keep cached values and produce source notes.
Manual override (a skipped week or a correction): Actions → Update forecast and deploy → Run workflow, fill in the fuels you
have (rollback is negative, e.g. -0.50; leave date as auto for the most recent Tuesday). Or edit data/actuals.json.

Local use
  npm test        parsers, maths, saved-input offline updater and reader-presentation tests
  npm run update  fetch data and regenerate data/*.json (needs pdftotext: brew install poppler, or apt install poppler-utils)
  npm run serve   preview at http://localhost:3000

Files
  index.html, assets/          the page
  data/forecast.json           what the page reads (generated)
  data/market.json             cached price series, used if a source is down (generated)
  data/forecast-log.json       every forecast made, for comparing with actuals (generated)
  data/actuals.json            actual adjustments (filled from the DOE, editable)
  data/ytd.json, notices.json  DOE reports already read (generated)
  data/news.json               estimates read from news headlines (generated)
  scripts/model.mjs            forecasting maths
  scripts/market.mjs           Opinet, Yahoo and FX data
  scripts/news.mjs             news cross-check
  scripts/health.mjs           fails the run when something needs a person
  scripts/update.mjs           data and forecast
  scripts/schedule.mjs         skip covered slots and catch up overdue updates
  scripts/doe.mjs              DOE report reader
  scripts/add-actual.mjs       manual actual helper
  scripts/test.mjs             tests
  .github/workflows/update.yml schedule and deploy
-->
