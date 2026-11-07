# Method

This document is the engineering record behind the console: data, equations, assumptions, validation and limitations. Every number here is produced by `pipeline/run.py` and written to `public/data/summary.json`; nothing is typed in by hand.

## 1. Data

**Building Data Genome Project 2** (BDG2), Miller, C., Kathirgamanathan, A., Picchetti, B. et al. (2020). *The Building Data Genome Project 2, energy meter data from the ASHRAE Great Energy Predictor III competition.* Scientific Data 7, 368. https://doi.org/10.1038/s41597-020-00712-x. Repository: https://github.com/buds-lab/building-data-genome-project-2. Licence: **CC BY-SA 4.0** (checked in the repository's LICENSE file). The derived JSON in `public/data/` is shared under the same licence.

Files used:

| File | Size | Content |
|---|---|---|
| `data/meters/cleaned/chilledwater_cleaned.csv` | 77 MB | hourly chilled-water energy, 555 meters, 2016-01-01 to 2017-12-31 |
| `data/weather/weather.csv` | 19.5 MB | hourly dry-bulb, dew point and more for each site |
| `data/metadata/metadata.csv` | 0.3 MB | site, use type, floor area |

These are campus and commercial buildings across 11 North American sites, not data centers. A chilled-water meter is a real, weather-driven cooling load measured the same way a mission-critical plant's would be, so it stands in for one; the absolute loads and schedules differ.

The downloads live in their own folder outside the repository and are read with `python -I` (isolated mode).

## 2. Pipeline

```
hourly meters ──clean──> daily kWh(th) ──┐
hourly weather ──psychrometrics──> daily dry-bulb, wet-bulb ──┤
                                              2016: fit change-point baseline (BIC over 8 candidates)
                                              2017: residuals -> standardized z -> two-sided CUSUM
                                              alarm -> onset, excess, pattern, confidence -> work-order queue
```

### 2.1 Cleaning (`pipeline/clean.py`)
* Meters with < 80 % hourly coverage are dropped (555 → 508).
* Negative readings → missing.
* Stuck meter: a non-zero value repeated unchanged for ≥ 24 h → missing (53,550 meter-hours).
* Spikes: Hampel filter, 25-hour centred window, flag |x − median| > 6 · 1.4826 · MAD (115,964 meter-hours, about 1.3 %).
* Daily total = sum of valid hours × 24 / n_valid, kept only when n_valid ≥ 20.
* Duplicate series (same site, Pearson r > 0.9999 over both years) are dropped, keeping the first (6 dropped).
* A meter is modelled if it has ≥ 240 valid days in each year and a 2016 mean ≥ 50 kWh/day: **474 meters**.

### 2.2 Psychrometrics (`pipeline/psychro.py`)
Relative humidity from dew point with the Magnus form (Alduchov and Eskridge 1996):

  e_s(T) = 0.61094 · exp(17.625 T / (243.04 + T))  [kPa],  RH = 100 · e_s(T_d) / e_s(T)

Wet-bulb from Stull (2011), sea-level pressure:

  T_w = T·atan(0.151977 (RH + 8.313659)^½) + atan(T + RH) − atan(RH − 1.676331) + 0.00391838 RH^1.5 atan(0.023101 RH) − 4.686035

Hourly values are averaged to daily means.

### 2.3 Baseline: change-point regression (`pipeline/changepoint.py`)
For each meter, daily cooling energy E is regressed on one outdoor driver x (daily mean dry-bulb **or** wet-bulb) and a day-type flag w (1 on weekends and US federal holidays), in the four ASHRAE Guideline 14 / Inverse Modeling Toolkit forms:

| Form | Model |
|---|---|
| 2P | E = β₀ + β₁ x + β_w w |
| 3PC | E = β₀ + β₁ (x − c)⁺ + β_w w |
| 4P | E = β₀ + β₁ (c − x)⁺ + β₂ (x − c)⁺ + β_w w |
| 5P | E = β₀ + β₁ (c₁ − x)⁺ + β₂ (x − c₂)⁺ + β_w w, c₁ < c₂ |

(u)⁺ = max(u, 0). Change points are grid-searched over the 5th to 95th percentiles of x (41 points for one change point, all ordered pairs from a 25-point grid for 5P); the remaining coefficients are OLS. A cooling slope must be ≥ 0. Across 2 drivers × 4 forms, the model with the lowest

  BIC = n ln(SSE / n) + k ln n,  k = coefficients + change points

is kept. Fit on 2016 only; 2017 is held out.

Goodness of fit, ASHRAE Guideline 14 (p = number of parameters):

  CV(RMSE) = 100 · √(Σ(yᵢ − ŷᵢ)² / (n − p)) / ȳ,  NMBE = 100 · Σ(yᵢ − ŷᵢ) / ((n − p) ȳ)

Daily-data compliance: CV(RMSE) ≤ 25 % and |NMBE| ≤ 10 %.

### 2.4 Comparison models
* **Gradient-boosted trees** (`HistGradientBoostingRegressor`, 150 iterations, learning rate 0.08, 15 leaves): dry-bulb, wet-bulb, dew point, day of week, holiday, day of year. Trained on 2016, scored on 2017.
* **Naive**: the same weekday one year earlier (364-day lag).

### 2.5 Drift detection: two-sided tabular CUSUM (`pipeline/cusum.py`)
Standardized residual z_t = (E_t − Ê_t) / σ̂, with σ̂ the 2016 residual standard deviation (ddof = k).

  C⁺_t = max(0, z_t − k + C⁺_{t−1}),  C⁻_t = max(0, −z_t − k + C⁻_{t−1}),  alarm when C⁺ or C⁻ > h

k = 0.5 (tuned to a 1σ shift). The onset estimate is the last day the alarming statistic was zero.

**Threshold calibration.** The textbook h = 5 gives an in-control average run length (ARL₀) of 465 days on independent noise. Daily building residuals are strongly autocorrelated, so h = 5 alarms far sooner. ARL₀ is therefore measured on the real 2016 residuals of every meter whose baseline meets Guideline 14 (207 meters) with an **AR(1) sieve bootstrap**: fit z_t = φ z_{t−1} + u_t per meter, simulate 20 new 730-day series from φ with innovations resampled from the real u_t, run the CUSUM, average the run length. h is the smallest grid value with ARL₀ ≥ 365 days, i.e. about one false alarm per plant per year:

| h | 5 | 8 | 10 | 12 | 14 | 15 | **16** | 18 | 20 |
|---|---|---|---|---|---|---|---|---|---|
| ARL₀ (days) | 49 | 118 | 187 | 260 | 328 | 363 | **394** | 449 | 499 |

A moving-block bootstrap was tried first and rejected: drawing a 730-day series from 366 days of blocks can only replay runs already in the sample, which pushed the ARL₀ of pure iid noise from 465 to 855 days. The sieve bootstrap gives 466 on the same noise, matching the textbook value.

### 2.6 Sizing and triage
For upward alarms, excess = Σ(E − Ê) from the onset to 31 Dec 2017, in kWh thermal. Ton-hours = kWh(th) / 3.51685 (1 ton = 12,000 Btu/h). Electric kWh = ton-h × kW/ton (default 0.6, editable in the UI).

An excess is **only sized** when the baseline met Guideline 14 in 2016 *and* the meter's chilled-water intensity is plausible (≤ 3,000 kWh/m²·yr). Guideline 14 exists precisely so that savings or losses are not claimed from a weak model. 85 meters fail the intensity gate (77 of them at one site, whose readings are two to three orders of magnitude above any physical cooling intensity, so its units are suspect). Their alarms are still listed, because the CUSUM works on unitless z, but without a ton-hour figure.

Pattern of the post-onset excess: regress post-onset residuals on [1, cooling term, w], where the cooling term is the model's own (x − c)⁺. The largest positive contribution with t > 3 names the pattern:

| Pattern | Meaning | First checks |
|---|---|---|
| slope | excess grows with outdoor wet-bulb or dry-bulb | coil and strainer dP, evaporative media and nozzles, chiller approach |
| baseload | excess on cool days too | valve leak-by, setpoint overrides, simultaneous heating and cooling |
| schedule | excess on weekends and holidays | BMS occupancy schedules, AHUs running unoccupied |

Confidence: **high** if 2016 CV(RMSE) ≤ 15 % and ≥ 65 % of post-alarm days sit above baseline; **medium** if CV(RMSE) ≤ 25 % and ≥ 55 %; otherwise **low**.

## 3. Validation

All checks run in `pytest` (12 tests, all passing) or in the pipeline itself.

| Check | Target | Result |
|---|---|---|
| Hand calculation: 3PC fit vs closed-form OLS (normal equations β = (XᵀX)⁻¹Xᵀy at the fitted change point) | equal within 1e-6 | passes |
| Synthetic 3PC data, c = 18 °C, β₁ = 80 | recover c within 1 °C, β₁ within 4 | passes |
| BIC picks 2P on linear data and a change-point form on change-point data | correct form | passes |
| Stull wet-bulb at 20 °C, 50 % RH vs psychrometric chart (13.7 °C) | within 0.3 °C | 13.70 °C |
| Stull vs psychrometer equation (bisection), 5 to 40 °C × 20 to 95 % RH | max error < 1 °C | 0.61 °C |
| CUSUM hand trace on z = [0, 2, 2, 2, 2], k = 0.5, h = 4 | C⁺ = 0, 1.5, 3, 4.5, 6; alarm day 4, onset day 2 | passes |
| CUSUM ARL vs Montgomery, *Introduction to SQC*, Table 9.3 (k = 0.5, h = 5) | ARL₀ = 465, ARL(1σ) = 10.4 | 465.0 and 10.41 |
| Sieve bootstrap on iid noise recovers the textbook ARL₀; on AR(1) φ = 0.7 noise it is much shorter | 380 to 560; < 120 | passes |
| Cleaning removes an injected spike and a 28 h stuck run; daily scaling exact | | passes |

### 3.1 Baseline quality (474 meters)

| Model | Scored on | Meets G14 | Median CV(RMSE) | Median abs NMBE |
|---|---|---|---|---|
| Change-point (best of 8, BIC) | 2016, in-sample | 43.7 % | 27.1 % | 0.0 % |
| Change-point | 2017, held out | 28.5 % | 34.2 % | 8.4 % |
| Gradient-boosted trees | 2017, held out | 28.5 % | 36.6 % | 9.3 % |
| Same weekday last year | 2017, held out | 5.1 % | 59.9 % | 10.3 % |

The 2017 figures mix model error with genuine year-to-year change, which is what the detector is looking for, so they understate model quality. The comparison between rows is fair because all three see the same 2017. The ML model does not beat the eight-parameter change-point model on held-out data; both beat the naive baseline by a wide margin. The change-point model is kept for scoring because its slope and change point carry physical meaning for the pattern diagnosis.

Model forms chosen: 3PC 223, 4P 210, 2P 32, 5P 9. Driver: wet-bulb chosen for 268 of 474 meters (57 %), dry-bulb for 206; the median R² difference between the two is only 0.004, so for these buildings the choice of driver matters far less than the model form.

### 3.2 Detector check (labelled synthetic steps)
**These faults are synthetic and labelled as such.** On the 33 meters with a Guideline 14 baseline and no 2017 alarm, a step of +5, +10 or +20 % of the mean predicted daily load was added to the real 2017 data from a random onset day (day 30 to 250), four onsets per meter (132 trials per size). The same trials were also run through a "monthly review" rule: flag the first month whose total exceeds the baseline by more than 10 %.

| Step | CUSUM detected | CUSUM median delay (p90) | Monthly rule detected | Monthly median delay | Monthly false flag before onset |
|---|---|---|---|---|---|
| +5 % (≈ 0.23σ) | 47.7 % | 103 d (202) | 62.1 % | 94.5 d | 19.7 % |
| +10 % (≈ 0.47σ) | 74.2 % | 67 d (154) | 71.2 % | 48 d | 20.5 % |
| +20 % (≈ 0.94σ) | 98.5 % | 26.5 d (70) | 84.1 % | 27 d | 15.9 % |

On in-control 2016 data the monthly rule flags 1.45 months per meter-year and fires at least once on 73 % of compliant meters; the calibrated CUSUM is held to about one alarm per plant-year. The CUSUM is **not** faster than a monthly review. Its value is that it holds a known false-alarm rate and catches large steps more reliably (98.5 % vs 84.1 %). Small steps (5 %) are below what either method finds reliably within a season on daily data this noisy.

These 33 meters were selected for having no alarm, which is the best case for the CUSUM's own false-alarm behaviour; its false-alarm rate comes from the bootstrap in 2.5 instead.

## 4. Results on the real 2017 data
At h = 16: 165 meters alarm upward, 232 downward, 77 stay in control (at the textbook h = 5: 172 up, 291 down, only 11 in control, i.e. 98 % of plants alarm).

* 52 upward alarms are sizable. Together they carry 13.1 million ton-hours of excess over their post-onset periods (7.9 GWh electric at 0.6 kW/ton). **8 plants carry half of it; 18 carry 80 %.**
* Median sized excess: 11.1 % above baseline; median 27 days from estimated onset to alarm.
* Pattern of all 165 upward alarms: baseload 109, slope 55, schedule 1.
* For the real alarms, the monthly 10 % rule flagged the same plant a median of 2 days earlier than the CUSUM (sizable alarms) and 3 days earlier across all; see 3.2 for why that earliness comes with false flags.

## 5. Assumptions
* BDG2 meter values are energy in kWh (thermal for chilled water), as documented by the dataset; one site fails a physical plausibility check and is not sized.
* Meter and weather timestamps are both local time; daily aggregation makes a one-hour offset immaterial.
* 2016 is a representative baseline year for each meter. Any change already present in 2016 is absorbed into the baseline.
* A weekend/holiday offset is enough to represent occupancy; academic calendars (term breaks) are not modelled, and they are a known source of alarms on education buildings.
* Plant efficiency of 0.6 kW/ton is a typical figure for a water-cooled chiller plant and only scales the electric estimate.

## 6. Limitations
* Not data-center data. Data-center cooling loads are flatter and driven by IT load as much as weather; a real deployment would add IT kW as a regressor.
* Daily resolution. Hourly models would detect faster, at the cost of modelling the daily profile.
* The CUSUM does not tell a fault from a legitimate change (new occupants, a lab added, a term schedule). That is why every alarm becomes a ranked check list, not an automatic work order.
* Excess from a moving onset to year end; a longer record would allow a proper post-alarm window.
* The pattern rule is a three-term regression on post-onset residuals; it points a technician to the first checks, it does not diagnose a component.

## Reproduce
```bash
python -m venv .venv && .venv/bin/pip install pandas numpy scipy scikit-learn pytest
# download the three BDG2 files into a separate folder, e.g. ../_downloads/bdg2
OMP_NUM_THREADS=2 .venv/bin/python -I pipeline/run.py ../_downloads/bdg2 public/data
.venv/bin/python -I -m pytest -q
```
