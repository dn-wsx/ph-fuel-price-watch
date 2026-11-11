# PH Fuel Price Watch

An estimate of next Tuesday's pump price change in the Philippines (gasoline, diesel and kerosene), updated automatically every day. It is free, needs no sign-up, and shows how close past estimates came to what the DOE announced.

**Live site: https://dn-wsx.github.io/ph-fuel-price-watch/**

## What you see on the page
- **The estimate**, in pesos per liter, for each fuel. Negative and green is a rollback. Positive and red is a hike.
- **Typical range.** Wide early in the week, tighter as more trading days come in. The final adjustment landed inside it in about 3 of 4 past weeks, so it is a typical range, not a guarantee.
- **Trading days.** "Based on 2 of 5 trading days" tells you how much of the week's Singapore trading has been seen so far.
- **Confidence** (low, medium, high), based on how many days have been seen and how much history there is.
- **News cross-check.** From about Thursday, news outlets publish their own estimates. They are listed beside ours for comparison and are not used in our number.
- **Forecast vs. actual.** For each past Tuesday: our forecast, the adjustment the DOE announced, and the miss. Green is within ₱1, amber is ₱1 to ₱2.50, red is more. Rows marked with * were rebuilt afterwards from that week's finished data.
- **How the live forecasts did.** The page saves what it actually says each day of the week. Once a saved week has been announced, this table shows the real average miss at each point of the week, from Tuesday morning to the final estimate. It started with the 17 November 2026 adjustment, so it fills in from there.

## Why the price moves on Tuesdays
Oil companies adjust pump prices every Tuesday. The change follows the average Singapore (MOPS) price of each product from Monday to Friday of the week before, compared with the week before that, converted to pesos, plus 12% VAT. So the estimate gets firmer as the week goes on. Until Friday, days that have not happened yet are assumed to stay at the latest price, and the range allows for that.

## Where the numbers come from
- **Singapore product prices:** the public price page of Korea's Opinet (KNOC). It lists the daily Singapore price of gasoline (RON 92), diesel (0.001%S) and kerosene, a day after they trade. These are the products the DOE's weekly Oil Monitor tracks: the DOE's weekly change in "international" gasoline and diesel prices matches the change in these figures to within US$0.1 per barrel (16 weeks checked).
- **Exchange rate:** Frankfurter (ECB reference rates). It matched the peso average quoted by the DOE to within ₱0.04.
- **Actual adjustments:** the DOE's "Prior Notice on Price Adjustments" and weekly Oil Monitor, read automatically.
- **News cross-check:** news headlines found through Google News.
- **Backup:** when the Singapore data is missing (not posted yet on Tuesday morning, or unreadable), the page says so and uses US futures prices (Yahoo Finance) instead, with a wider range fitted on how those futures have done. They miss Asian price moves, so treat that as rough.

## How accurate is it
Checked against the 12 weeks of announced adjustments from August to November 2026, using each week's finished data:

| Fuel | Average miss | Direction right |
|---|---|---|
| Gasoline | ₱0.86 per liter | 12 of 12 weeks |
| Diesel | ₱0.65 per liter | 12 of 12 weeks |
| Kerosene | ₱0.61 per liter | 12 of 12 weeks |

Earlier in the week it is rougher. Against the final adjustment, the typical miss is about ₱1.9 after the first trading day, ₱0.9 to ₱1.3 after the third, and ₱0.6 to ₱1.0 by the fourth and fifth.

Some weeks the companies do not pass the Singapore change through one for one. In the week of 10 November 2026 the Singapore price implied a gasoline rollback of about ₱11.90, but ₱16.80 was announced. Those weeks cannot be predicted from public data. Twelve weeks in one volatile period is also a short track record, so treat these figures as a good sign, not a guarantee.

## When it updates
Automatically, four times a day (Philippine time, give or take a few minutes):
- **About 6:15 AM**, Monday to Saturday
- **About 11:45 AM, 3:15 PM and 6:45 PM**, Tuesday to Saturday

GitHub can start scheduled runs hours late, so the page may lag a little behind these times. Singapore prices appear on Opinet a day late, so the estimate trails same-day posts by about half a day. That costs very little accuracy, because the main uncertainty early in the week is the days still to come. On Tuesday morning, before Opinet has posted the new week's first trading day, the page shows an early look from US futures with a wider range and says so. If updates stop, the page shows a warning.

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
The workflow runs on a cron schedule (see .github/workflows/update.yml), at odd minutes because GitHub delays or drops runs
at the top of the hour and on :30. GitHub may also pause scheduled runs after 60 days without repository activity. If that
happens, press "Enable workflow" in the Actions tab.
data/market.json records when Opinet first showed each new Singapore day (opinetSeen: the run before it, "after", and the run
that saw it, "by"). Once a few weeks of that exist, drop the runs that never catch anything new.

Alerts
The "health" job runs scripts/health.mjs after each update and fails the run when Opinet cannot be read, Singapore prices stop
for more than 5 days, no forecast is produced, or the DOE reports cannot be read. GitHub emails the owner about failed
scheduled runs (check Settings → Notifications → Actions). It cannot alert when GitHub does not start a run at all; the page's
own warning covers that for readers.

Live track record
Each run saves a snapshot per number of Singapore days seen (plus "early" for the Tuesday US-futures look) in
data/forecast-log.json under snapshots. liveTrack() in scripts/model.mjs turns finished weeks into the page's table.

Actual adjustments
Each run reads two DOE publications and never overwrites values entered by hand:
- Prior Notice on Price Adjustments (doe.gov.ph, retail pump prices, price adjustments): one row per oil company, posted before
  the Tuesday. A fuel is recorded only when at least 3 companies filed and at least 60% agree. Marked provisional.
- Oil Monitor (doe.gov.ph, oil monitor): each report states the year-to-date net change. This week's total minus last week's
  total is the official actual and replaces the provisional value.
If a report cannot be read or does not line up, that week is skipped rather than guessed.
Manual override (a skipped week or a correction): Actions → Update forecast and deploy → Run workflow, fill in the fuels you
have (rollback is negative, e.g. -0.50; leave date as auto for the most recent Tuesday). Or edit data/actuals.json.

Local use
  npm test        model, market-data and news-parser tests
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
  scripts/doe.mjs              DOE report reader
  scripts/add-actual.mjs       manual actual helper
  scripts/test.mjs             tests
  .github/workflows/update.yml schedule and deploy
-->
