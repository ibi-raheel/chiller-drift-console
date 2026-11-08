# Chiller Drift Console

**Question.** When you run many cooling plants, how do you tell a plant that has really drifted from one that just had a hot, humid week, and which one do you send a technician to first?

**Answer, measured on 474 real chilled-water plants.** Judged against its own weather baseline, 165 of 474 plants drifted up in a year. The textbook alarm limit would have flagged 98 % of plants; an alarm scaled to each plant's own noise, with its limit calibrated on real residuals, holds about one false alarm per plant-year. 8 plants carry half of the 13.1 million ton-hours of sizable excess.

**Solution.** A one-page playbook (baseline, calibrated alarm, ranked work order) and a one-command tool, `tools/drift_check.py`. See [SOLUTION.md](SOLUTION.md). All of this is measured on public building data; it has not been run on a data-center plant, and the next step is to validate it on one site's history.

Fits a weather-normalized baseline to every real chilled-water meter, flags drift with a calibrated CUSUM, and ranks the drift into a sized work-order queue for facility engineers.

**Live demo:** to be added after deployment

## The problem
A cooling plant's energy moves with the weather far more than with any single fault, so a fouled coil, a leaking valve or a forgotten setpoint override hides inside normal seasonal swings. Facility teams running many plants need to know which plant has stopped behaving like itself, since when, and how much it costs, so the fix becomes a planned work order instead of an emergency.

## What it does
The pipeline runs on 474 real chilled-water meters from 11 sites (Building Data Genome Project 2, 2016 to 2017):

1. **Baseline.** For each meter it fits the ASHRAE Guideline 14 change-point models (2P, 3PC, 4P, 5P) on outdoor dry-bulb and on wet-bulb, and picks one of the 8 by BIC. Median R² is 0.83.
2. **Drift.** It scores 2017 against the 2016 baseline with a two-sided CUSUM. The threshold comes from the real, autocorrelated residuals (AR(1) sieve bootstrap) so a plant raises about one false alarm a year. The textbook threshold would alarm on 98 % of plants.
3. **Queue.** It sizes the excess in ton-hours, only where the baseline meets Guideline 14, then labels the pattern (weather-driven slope, baseload, or schedule) and suggests what to check first.

Measured results:
* 165 plants drift upward in 2017; 52 have a baseline good enough to size. **8 plants carry half of the 13.1 million ton-hours of sized excess.**
* On labelled synthetic +20 % steps the CUSUM catches 98.5 % (median 26.5 days), while a "month over 10 %" review catches 84.1 % and flags 15.9 % of trials before any fault exists.
* On held-out 2017 data the change-point baseline matches gradient-boosted trees (28.5 % of meters meet Guideline 14 with either), and both beat "same day last year" (5.1 %).

All equations, assumptions, validation and limitations are in [METHOD.md](METHOD.md).

## How it works
* `pipeline/clean.py`: stuck-meter and Hampel spike removal, daily aggregation, duplicate-meter check.
* `pipeline/psychro.py`: RH from dew point (Magnus), wet-bulb (Stull 2011), checked against the psychrometer equation.
* `pipeline/changepoint.py`: change-point regressions with grid search plus OLS, BIC selection, CV(RMSE) and NMBE.
* `pipeline/cusum.py`: tabular CUSUM, onset estimate, ARL by simulation and by sieve bootstrap.
* `pipeline/run.py`: the end-to-end run. It writes static JSON to `public/data/`, which the front end reads. There are no API keys and no server.
* `tools/drift_check.py`: the same pipeline as a CLI; meters + weather in, `queue.csv` and `summary.md` out. See [SOLUTION.md](SOLUTION.md).
* `tests/`: 14 pytest checks, including a closed-form OLS hand calculation, the published CUSUM ARL table, and psychrometric chart values.

## Run locally
```bash
# analysis
python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -I pipeline/run.py <folder with the three BDG2 files> public/data
.venv/bin/python -I -m pytest -q
.venv/bin/python -I tools/drift_check.py --meters <dir>/chilledwater_cleaned.csv --weather <dir>/weather.csv --metadata <dir>/metadata.csv --calibrate --out out/

# front end
npm install
npm run dev
```

## Data
Real meter and weather data from the **Building Data Genome Project 2**: Miller, C. et al. (2020), *Scientific Data* 7, 368, https://doi.org/10.1038/s41597-020-00712-x, https://github.com/buds-lab/building-data-genome-project-2. Licensed **CC BY-SA 4.0**. The derived JSON in `public/data/` is shared under the same licence. These are campus and commercial buildings, not data centers. The only synthetic data are the labelled step faults used to test the detector.

---
Built by Ibi Raheel, mechanical engineer building AI tools. More work at [ibiraheel.com](https://ibiraheel.com).
