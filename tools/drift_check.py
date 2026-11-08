"""drift_check: one command from meter + weather history to a ranked work-order list.

A thin CLI over the existing pipeline. It adds no new method: it cleans, baselines, scores and
sizes each plant with the same functions and constants as pipeline/run.py, then writes
queue.csv (one row per plant) and summary.md (one page).

Usage:
  python -I tools/drift_check.py --meters chilledwater.csv --weather weather.csv \
      [--metadata metadata.csv] [--baseline-year 2016] [--score-year 2017] \
      [--h 16 | --calibrate] [--kw-per-ton 0.6] [--only id1,id2] --out out/

Inputs use the BDG2 layout: meters = hourly wide CSV (timestamp + one kWh(th) column per meter),
weather = site_id, timestamp, airTemperature, dewTemperature, metadata = building_id, sqm, ...
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))  # -I drops the script dir

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from pandas.tseries.holiday import USFederalHolidayCalendar  # noqa: E402

from changepoint import cvrmse, fit_best, nmbe  # noqa: E402
from clean import clean_hourly, to_daily  # noqa: E402
from cusum import arl_sieve_bootstrap, cusum, first_alarm  # noqa: E402
from run import (CHECKS, G14_CV, G14_NMBE, K_REF, KWH_PER_TON_HOUR, MAX_KWH_PER_M2_YR,  # noqa: E402
                 MIN_DAYS_PER_YEAR, MIN_HOURLY_COVERAGE, MIN_MEAN_DAILY_KWH, SEED, daily_weather, diagnose)

H_GRID = (5.0, 8.0, 10.0, 12.0, 13.0, 14.0, 15.0, 16.0, 17.0, 18.0, 20.0)
LABEL = {"real": "real, investigate", "weak": "can't cost yet: weak baseline",
         "units": "check meter: units", "down": "load fell: check sensor", "none": "in control"}


def prepare(meters: pd.DataFrame, weather: pd.DataFrame, y0: int, y1: int):
    cw = meters.sort_index()
    cw = cw.loc[:, cw.notna().mean() >= MIN_HOURLY_COVERAGE]
    daily = to_daily(clean_hourly(cw)[0])
    corr, dups, cols = daily.corr(min_periods=300), set(), list(daily.columns)
    for i, a in enumerate(cols):  # same series under two names: keep the first
        for b in cols[i + 1:]:
            if a not in dups and b not in dups and a.split("_")[0] == b.split("_")[0] and corr.at[a, b] > 0.9999:
                dups.add(b)
    hol = set(USFederalHolidayCalendar().holidays(f"{y0}-01-01", f"{y1}-12-31"))
    return daily.drop(columns=sorted(dups)), daily_weather(weather), hol


def baseline(bid, y, W, hol, y0, y1, sqm):
    """Fit the plant's own weather baseline on y0; return a plant dict or None if it can't be modelled."""
    ok = y.notna() & W["drybulb"].notna() & W["wetbulb"].notna()
    tr, te = ok & (y.index.year == y0), ok & (y.index.year == y1)
    if tr.sum() < MIN_DAYS_PER_YEAR or te.sum() < MIN_DAYS_PER_YEAR or y[tr].mean() < MIN_MEAN_DAILY_KWH:
        return None
    w = ((y.index.day_of_week >= 5) | y.index.normalize().isin(hol)).astype(float)
    m, _ = fit_best({"drybulb": W["drybulb"][tr].values, "wetbulb": W["wetbulb"][tr].values}, w[tr.values], y[tr].values)
    x = W[m.driver].values
    pred = np.where(ok, m.predict(np.nan_to_num(x), w), np.nan)
    yv, t = y.values, tr.values
    cv, nm = cvrmse(yv[t], pred[t], m.k), nmbe(yv[t], pred[t], m.k)
    inten = float(np.nanmean(yv[t])) * 365 / sqm if sqm else None
    return dict(plant=bid, model=m, y=yv, pred=pred, x=x, w=w, tr=t, te=te.values, dates=y.index,
                cv=cv, nm=nm, g14=bool(cv <= G14_CV and abs(nm) <= G14_NMBE),
                units_ok=bool(inten is not None and inten <= MAX_KWH_PER_M2_YR), z=(yv - pred) / m.sigma)


def score(p, h, kw_per_ton):
    """CUSUM the score year against the baseline; size, read the pattern and label any alarm."""
    te = p["te"]
    z, d = p["z"][te], p["dates"][te]
    cp, cm = cusum(z, K_REF, h)
    ia, side, onset = first_alarm(cp, cm, h)
    row = dict(plant=p["plant"], form=p["model"].form, driver=p["model"].driver, cvrmse=round(p["cv"], 1),
               nmbe=round(p["nm"], 1), g14=p["g14"], status="in control", onset="", alarm="", excess_ton_h=None,
               mwh_elec=None, pct_over=None, pattern="", confidence="", label=LABEL["none"], first_checks="",
               _z=0.0, _ton=None)
    if ia is None:
        return row
    e = (p["y"] - p["pred"])[te][onset:]
    kind = "down" if side == "down" else diagnose(e, p["x"][te][onset:], p["w"][te][onset:], p["model"])[0]
    net = float(np.nansum(e))
    frac = float(np.mean((p["y"] - p["pred"])[te][ia:] > 0) if side == "up" else np.mean((p["y"] - p["pred"])[te][ia:] < 0))
    conf = ("high" if p["cv"] <= 15 and frac >= 0.65 else "medium" if p["cv"] <= G14_CV and frac >= 0.55 else "low")
    sized = side == "up" and p["units_ok"] and p["g14"]
    ton_h = net / KWH_PER_TON_HOUR if sized else None
    lab = ("down" if side == "down" else "real" if sized else "units" if not p["units_ok"] else "weak")
    row.update(status=f"drift {side}", onset=str(d[onset].date()), alarm=str(d[ia].date()),
               excess_ton_h=None if ton_h is None else round(ton_h), pattern=kind, confidence=conf,
               mwh_elec=None if ton_h is None else round(ton_h * kw_per_ton / 1000, 1),
               pct_over=round(net / np.nansum(p["pred"][te][onset:]) * 100, 1), label=LABEL[lab],
               first_checks=CHECKS[kind], _z=float(np.nanmean(z[onset:])), _ton=ton_h)
    return row


def calibrate(plants, target=365.0):
    """Smallest h whose AR(1) sieve-bootstrap ARL0 on the plants' own baseline residuals is >= target days."""
    res = [p["z"][p["tr"]] for p in plants if p["g14"]]
    arl = {h: arl_sieve_bootstrap(res, K_REF, h, reps=20, horizon=730, seed=SEED) for h in H_GRID}
    return next((h for h in sorted(arl) if arl[h] >= target), max(arl)), arl


def rank(rows):
    """Sized drift first by ton-hours, then unsized upward drift by mean z, then downward drift, then the rest."""
    def key(r):
        if r["_ton"] is not None:
            return (0, -r["_ton"])
        return ({"drift up": 1, "drift down": 2}.get(r["status"], 3), -r["_z"])
    out = sorted(rows, key=key)
    for i, r in enumerate(out):
        r["rank"] = i + 1
    pos = np.array([max(r["_ton"], 0) for r in out if r["_ton"] is not None], float)
    cum = np.cumsum(pos) / pos.sum() if pos.sum() > 0 else np.array([])
    n50 = int(np.searchsorted(cum, 0.5) + 1) if len(cum) else 0
    n80 = int(np.searchsorted(cum, 0.8) + 1) if len(cum) else 0
    return out, dict(total_ton_h=float(pos.sum()), plants_for_50pct=n50, plants_for_80pct=n80)


def run(meters, weather, bldg=None, y0=2016, y1=2017, h=16.0, do_calibrate=False, kw_per_ton=0.6):
    daily, wxd, hol = prepare(meters, weather, y0, y1)
    sqm = {} if bldg is None else bldg.set_index("building_id")["sqm"].dropna().to_dict()
    sites = set(wxd.index.get_level_values(0))
    plants = [p for bid in daily.columns if bid.split("_")[0] in sites
              for p in [baseline(bid, daily[bid], wxd.loc[bid.split("_")[0]].reindex(daily.index), hol, y0, y1,
                                 sqm.get(bid))] if p is not None]
    arl = None
    if do_calibrate:
        h, arl = calibrate(plants)
    rows, tot = rank([score(p, h, kw_per_ton) for p in plants])
    return rows, dict(h=h, arl0=arl, n_plants=len(plants), n_g14=sum(p["g14"] for p in plants),
                      n_up=sum(r["status"] == "drift up" for r in rows),
                      n_down=sum(r["status"] == "drift down" for r in rows),
                      n_sized=sum(r["excess_ton_h"] is not None for r in rows), kw_per_ton=kw_per_ton, **tot)


def write(rows, s, out: Path):
    out.mkdir(parents=True, exist_ok=True)
    cols = ["rank", "plant", "form", "driver", "cvrmse", "nmbe", "g14", "status", "onset", "alarm", "excess_ton_h",
            "mwh_elec", "pct_over", "pattern", "confidence", "label", "first_checks"]
    pd.DataFrame(rows)[cols].to_csv(out / "queue.csv", index=False)
    arl = f" (bootstrap ARL0 {s['arl0'][s['h']]:.0f} days)" if s["arl0"] else ""
    top = "\n".join(f"| {r['rank']} | {r['plant']} | {r['onset']} | {r['excess_ton_h']:,} | {r['pattern']} | {r['label']} |"
                    for r in rows[:10] if r["excess_ton_h"] is not None)
    (out / "summary.md").write_text(f"""# Drift check

* Plants modelled: {s['n_plants']}; baseline meets Guideline 14: {s['n_g14']}
* Alarm limit h = {s['h']:g}{arl}, k = {K_REF}
* Drift up: {s['n_up']} (sized: {s['n_sized']}); drift down: {s['n_down']}
* Sized excess: {s['total_ton_h']:,.0f} ton-h, {s['total_ton_h'] * s['kw_per_ton'] / 1000:,.0f} MWh(e) at {s['kw_per_ton']} kW/ton
* {s['plants_for_50pct']} plants carry 50 % of it; {s['plants_for_80pct']} carry 80 %

| Rank | Plant | Onset | Excess ton-h | Pattern | Label |
|---|---|---|---|---|---|
{top}

Full list with first checks: queue.csv
""")


def main(argv=None):
    a = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    a.add_argument("--meters", required=True, type=Path)
    a.add_argument("--weather", required=True, type=Path)
    a.add_argument("--metadata", type=Path)
    a.add_argument("--baseline-year", type=int, default=2016)
    a.add_argument("--score-year", type=int, default=2017)
    g = a.add_mutually_exclusive_group()
    g.add_argument("--h", type=float, default=16.0)
    g.add_argument("--calibrate", action="store_true")
    a.add_argument("--kw-per-ton", type=float, default=0.6)
    a.add_argument("--only", help="comma-separated meter ids to score (default: all)")
    a.add_argument("--out", required=True, type=Path)
    o = a.parse_args(argv)
    cols = None if not o.only else ["timestamp", *o.only.split(",")]
    meters = pd.read_csv(o.meters, parse_dates=["timestamp"], index_col="timestamp", usecols=cols)
    weather = pd.read_csv(o.weather, parse_dates=["timestamp"])
    bldg = pd.read_csv(o.metadata) if o.metadata else None
    rows, s = run(meters, weather, bldg, o.baseline_year, o.score_year, o.h, o.calibrate, o.kw_per_ton)
    write(rows, s, o.out)
    print(f"{s['n_plants']} plants, h = {s['h']:g}, {s['n_up']} drift up, {s['plants_for_50pct']} plants = 50 % "
          f"of {s['total_ton_h']:,.0f} ton-h -> {o.out / 'queue.csv'}")


if __name__ == "__main__":
    main()
