PH Fuel Price Watch — history fix

Copy these files over the matching paths in your existing repository:
- scripts/model.mjs
- scripts/update.mjs
- scripts/test.mjs
- assets/app.js

IMPORTANT:
Do NOT replace, delete, or empty any files in data/.
In particular, preserve your existing:
- data/actuals.json
- data/forecast-log.json
- data/market.json
- data/forecast.json
- data/actuals-meta.json

What this fixes:
- Forecast history is built from the union of forecast-log.json and actuals.json.
- Forecast-only weeks remain visible even if DOE actuals are not yet available.
- Actuals are shown alongside forecasts when available.
- Missing fuel values are handled safely by the UI.
- The history limit is raised to 52 weeks.

Run tests with: node scripts/test.mjs
Then run the GitHub Actions workflow to regenerate data/forecast.json and redeploy Pages.

Recovery:
If Stage 2 replaced your previous data files, restore data/actuals.json and
 data/forecast-log.json from the commit immediately before that replacement.
Use GitHub: open the file -> History -> select the earlier commit -> view raw/download,
or locally run git checkout <previous-commit> -- data/actuals.json data/forecast-log.json
Then commit the restored data before running the update workflow.
