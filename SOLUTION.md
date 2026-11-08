# Solution: cooling-plant drift, from baseline to work order

**Question.** When you run many cooling plants, how do you tell a plant that has really drifted from one that just had a hot, humid week, and which one do you send a technician to first?

**Measured answer.** Judged against its own weather baseline, 165 of 474 real cooling plants drifted up in a year. The textbook alarm limit would have flagged 98 % of plants; an alarm scaled to each plant's own noise, with its limit calibrated on real residuals, holds about one false alarm per plant-year. 8 plants carry half of the 13.1 million ton-hours of sizable excess.

Every number below comes from `public/data/summary.json` and `public/data/queue.json`, written by `pipeline/run.py`. [METHOD.md](METHOD.md) has the equations and validation.

## 1. The playbook (one page)

1. **Pull the data.** Two years of chilled-water (BTU) meter data per plant (one to fit the baseline, one to score), plus site dry-bulb and dew point. Clean it: drop meters under 80 % hourly coverage, stuck readings of 24 h or more, and Hampel spikes.
2. **Baseline each plant on its own data.** Fit the 8 ASHRAE Guideline 14 change-point models (2P, 3PC, 4P, 5P on dry-bulb or wet-bulb, with a weekend/holiday offset) and pick one by BIC.
3. **Cost only what the baseline can support.** Use a plant's numbers only if CV(RMSE) ≤ 25 % and |NMBE| ≤ 10 %. Weaker plants still alarm, but get no ton-hour figure.
4. **Calibrate the alarm limit on real residuals, not the textbook.** Each plant's residuals are scaled by its own noise; h = 5 then alarms on 98 % of plants (463 of 474), because daily residuals are autocorrelated. Measure the run length with an AR(1) sieve bootstrap of the real residuals and pick the smallest h that gives 365 days or more (h = 16 here, ARL₀ 394 days; h = 5 gives 49 days).
5. **On an alarm**, read the onset date, size the excess in ton-hours and kWh(e) at your kW/ton, and read the pattern:
   * **baseload**: excess on cool days too. Check valve leak-by, setpoint overrides, simultaneous heating and cooling.
   * **slope**: excess grows with wet-bulb. Check coil and strainer dP, evaporative media and nozzles, chiller approach.
   * **schedule**: excess on weekends and holidays. Check BMS schedules and units running unoccupied.
6. **Label each alarm, then rank by ton-hours.**
   * *real, investigate*: sized, with a pattern. Open a CMMS work order with the first checks.
   * *legit change, re-baseline*: a known load or occupancy change.
   * *can't cost yet*: weak baseline or a units problem. Check the meter.

## 2. Decision rules and thresholds

| Rule | Threshold | Where it comes from (measured) |
|---|---|---|
| Meter is usable | ≥ 80 % hourly coverage; ≥ 240 valid days per year; 2016 mean ≥ 50 kWh/day | 555 meters in the dataset → 474 modelled |
| Baseline may be used to cost drift | CV(RMSE) ≤ 25 %, \|NMBE\| ≤ 10 % (Guideline 14) and intensity ≤ 3,000 kWh/m²·yr | 52 of the 165 upward alarms are sized |
| Alarm limit | smallest h with bootstrap ARL₀ ≥ 365 days, k = 0.5 | h = 16, ARL₀ 394 days; textbook h = 5 gives 49 days and alarms on 98 % of plants |
| Confidence | high: CV(RMSE) ≤ 15 % and ≥ 65 % of days past the alarm on the drift side; medium: ≤ 25 % and ≥ 55 % | rank 1 plant: medium |
| Work-order order | sized alarms by excess ton-hours, then unsized ones by mean z after onset | 8 plants = 50 %, 18 plants = 80 % of 13.1 million ton-hours |

What the detector does and does not buy you:

* On labelled synthetic +20 % steps it catches 98.5 % (median 26.5 days to alarm), against 84.1 % for a "month over 10 %" review, which also flags 15.9 % of trials before the fault exists (132 trials).
* It is **not faster** than a monthly review on the real alarms: it fires a median 3 days later (161 alarms where both fired). It wins on a known false-alarm rate and on reliability for large steps.
* On held-out data the change-point baseline meets Guideline 14 on 28.5 % of meters, the same as gradient-boosted trees, and well above "same day last year" (5.1 %).

## 3. The tool

`tools/drift_check.py` is a thin CLI over the same pipeline functions (cleaning, psychrometrics, change-point fit, CUSUM, sieve bootstrap, pattern diagnosis). It adds no new method.

```bash
python -I tools/drift_check.py \
  --meters chilledwater_cleaned.csv --weather weather.csv --metadata metadata.csv \
  --baseline-year 2016 --score-year 2017 --calibrate --kw-per-ton 0.6 --out out/
```

* **Input** (BDG2 layout): meters = hourly wide CSV with a `timestamp` column and one kWh(th) column per meter; weather = `site_id, timestamp, airTemperature, dewTemperature`; metadata (optional) = `building_id, sqm`, used for the intensity gate. Meter ids start with their site id (`Site_use_name`).
* **`--h 16`** uses a fixed limit; **`--calibrate`** re-derives it from your own residuals. **`--only a,b,c`** scores a few meters.
* **Output**: `out/queue.csv`, one row per plant (rank, baseline form and driver, CV(RMSE), NMBE, G14 pass, status, onset, alarm date, excess ton-h, MWh(e), % over, pattern, confidence, label, first checks), and `out/summary.md`, one page.

On the public data it prints:

```
474 plants, h = 16, 165 drift up, 8 plants = 50 % of 13,087,159 ton-h -> out/queue.csv
```

and rank 1 is `Fox_education_Louie`: onset 2017-01-03, alarm 2017-02-09, +21.7 %, baseload, 1,195,715 ton-h. `tests/test_drift_check.py` checks this against the published `queue.json` on a three-meter slice and on the full fleet (it skips if the BDG2 files are absent; point `BDG2_DIR` at them).

## 4. Week 1 on a real site (one campus, read-only data)

Everything above is measured on public building meters (campuses, offices, public venues), not on a data-center plant. Week 1 is how to find out whether it holds on yours.

* **Day 1.** Get 12 to 24 months of plant data for one campus: chilled-water or cooling-plant BTU and kW (and makeup water if logged), site weather, IT load in kW, and the CMMS work-order history for the same equipment. Clean it with the same gates.
* **Day 2.** Run `drift_check`. Fit a baseline per plant or air-handling zone and report how many meet Guideline 14.
* **Day 3.** Add the one regressor a data hall needs: IT kW next to wet-bulb (the first limitation in METHOD.md). Re-calibrate the alarm limit on the site's own residuals with the sieve bootstrap.
* **Day 4.** Backtest against the CMMS. Do past alarms line up with work orders already closed (coil cleaning, valve replacement, media change)? How many alarms had no matching cause? Report both honestly.
* **Day 5.** Hand over the ranked queue and this playbook. Walk it with the facility engineers on shift, and agree which labels open a work order and which mean re-baseline.

---
Data: Building Data Genome Project 2, CC BY-SA 4.0. More at [ibiraheel.com](https://ibiraheel.com).
