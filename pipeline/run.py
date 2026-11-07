"""End-to-end pipeline: clean -> weather -> baselines -> CUSUM -> size -> validate -> JSON.

Usage:  python -I pipeline/run.py <bdg2_data_dir> <out_dir>
<bdg2_data_dir> holds chilledwater_cleaned.csv, weather.csv, metadata.csv (BDG2).
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops the script dir

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from pandas.tseries.holiday import USFederalHolidayCalendar  # noqa: E402
from sklearn.ensemble import HistGradientBoostingRegressor  # noqa: E402

from changepoint import cvrmse, fit_best, nmbe, design  # noqa: E402
from clean import clean_hourly, to_daily  # noqa: E402
from cusum import arl_sieve_bootstrap, arl_iid, cusum, first_alarm  # noqa: E402
from psychro import rh_from_dewpoint, wetbulb_stull  # noqa: E402

KWH_PER_TON_HOUR = 3.51685  # 1 refrigeration ton = 12,000 Btu/h = 3.51685 kW(th)
DEFAULT_KW_PER_TON = 0.6    # plant electric input per ton of cooling (editable in the UI)
K_REF = 0.5
H_PRD = 5.0
MIN_HOURLY_COVERAGE = 0.80
MIN_DAYS_PER_YEAR = 240
MIN_MEAN_DAILY_KWH = 50.0
MAX_KWH_PER_M2_YR = 3000.0  # chilled-water intensity above this = unit or metadata problem
MONTHLY_RULE = 0.10         # "monthly review" comparator: month total >10% over baseline
G14_CV, G14_NMBE = 25.0, 10.0
SEED = 7


def log(*a):
    print(f"[{time.strftime('%H:%M:%S')}]", *a, flush=True)


def load(data_dir: Path):
    cw = pd.read_csv(data_dir / "chilledwater_cleaned.csv", parse_dates=["timestamp"], index_col="timestamp")
    wx = pd.read_csv(data_dir / "weather.csv", parse_dates=["timestamp"])
    meta = pd.read_csv(data_dir / "metadata.csv")
    return cw, wx, meta


def daily_weather(wx: pd.DataFrame) -> pd.DataFrame:
    out = []
    for site, g in wx.groupby("site_id"):
        g = g.set_index("timestamp").sort_index()
        g = g[~g.index.duplicated()]
        g = g[["airTemperature", "dewTemperature"]].resample("h").mean().interpolate(limit=3)
        g["dewTemperature"] = np.minimum(g["dewTemperature"], g["airTemperature"])
        rh = rh_from_dewpoint(g["airTemperature"].values, g["dewTemperature"].values)
        g["wetbulb"] = wetbulb_stull(g["airTemperature"].values, rh)
        d = g.resample("D").mean()
        d["site_id"] = site
        out.append(d)
    d = pd.concat(out).rename(columns={"airTemperature": "drybulb", "dewTemperature": "dewpoint"})
    return d.reset_index().set_index(["site_id", "timestamp"])


def gbr_features(dates: pd.DatetimeIndex, wxd: pd.DataFrame, hol: set) -> np.ndarray:
    dow = dates.day_of_week.values
    holiday = np.array([d in hol for d in dates.normalize()], float)
    return np.column_stack([
        wxd["drybulb"].values, wxd["wetbulb"].values, wxd["dewpoint"].values,
        dow, holiday, dates.day_of_year.values,
    ])


def diagnose(e, x, w, model):
    """Classify post-onset excess as slope (weather-dependent), baseload, or schedule."""
    if model.form == "2P":
        cool = x - x.mean()
    elif model.form == "5P":
        cool = np.maximum(x - model.cps[1], 0)
    else:
        cool = np.maximum(x - model.cps[0], 0)
    X = np.column_stack([np.ones_like(x), cool, w])
    beta, *_ = np.linalg.lstsq(X, e, rcond=None)
    r = e - X @ beta
    dof = max(len(e) - 3, 1)
    s2 = (r @ r) / dof
    try:
        se = np.sqrt(np.diag(s2 * np.linalg.inv(X.T @ X)))
    except np.linalg.LinAlgError:
        se = np.full(3, np.inf)
    t = np.where(np.isfinite(beta / se), beta / se, 0.0)
    contrib = {
        "baseload": beta[0],
        "slope": beta[1] * cool.mean(),
        "schedule": beta[2] * w.mean() if beta[2] > 0 else 0.0,
    }
    sig = {"baseload": t[0] > 3, "slope": t[1] > 3, "schedule": t[2] > 3}
    cands = {k: v for k, v in contrib.items() if sig[k] and v > 0}
    kind = max(cands, key=cands.get) if cands else "baseload"
    return kind, {k: float(v) for k, v in contrib.items()}, {k: float(v) for k, v in zip(contrib, t)}


CHECKS = {
    "slope": "Excess grows with outdoor wet-bulb: check coil and strainer dP, evaporative media and spray nozzles, chiller approach temperature.",
    "baseload": "Excess on cool days too: check control-valve leak-by, chilled-water setpoint overrides, simultaneous heating and cooling.",
    "schedule": "Excess concentrated on weekends and holidays: check BMS occupancy schedules and air handlers running unoccupied.",
    "down": "Load fell below its baseline: check the flow meter and sensor first, then space vacancy or an upstream plant change. Not an excess work order.",
}


def main(data_dir: Path, out_dir: Path):
    rng = np.random.default_rng(SEED)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "detail").mkdir(exist_ok=True)
    log("load")
    cw, wx, meta = load(data_dir)
    cw = cw.sort_index()
    meta = meta.set_index("building_id")
    n_raw = cw.shape[1]
    cov = cw.notna().mean()
    cw = cw.loc[:, cov >= MIN_HOURLY_COVERAGE]
    n_cov = cw.shape[1]
    log("clean", n_raw, "->", n_cov)
    cwc, clean_stats = clean_hourly(cw)
    daily = to_daily(cwc)
    # duplicate meters (same series under two names) are dropped, keeping the first
    corr = daily.corr(min_periods=300)
    dups = set()
    cols = list(daily.columns)
    for i, a in enumerate(cols):
        if a in dups:
            continue
        for b in cols[i + 1:]:
            if b not in dups and a.split("_")[0] == b.split("_")[0] and corr.at[a, b] > 0.9999:
                dups.add(b)
    daily = daily.drop(columns=sorted(dups))
    wxd = daily_weather(wx)
    hol = set(USFederalHolidayCalendar().holidays("2016-01-01", "2017-12-31"))

    funnel = {"meters_in_dataset": n_raw, "meters_80pct_hourly": n_cov, "duplicates_dropped": len(dups)}
    plants, series, excluded = [], {}, {"low_days": 0, "tiny_load": 0, "no_weather": 0}
    gbr_rows, naive_rows = [], []
    resid16 = {}
    log("fit")
    for bid in daily.columns:
        site = bid.split("_")[0]
        if site not in wxd.index.get_level_values(0):
            excluded["no_weather"] += 1
            continue
        y = daily[bid]
        W = wxd.loc[site].reindex(y.index)
        ok = y.notna() & W["drybulb"].notna() & W["wetbulb"].notna()
        tr = ok & (y.index.year == 2016)
        te = ok & (y.index.year == 2017)
        if tr.sum() < MIN_DAYS_PER_YEAR or te.sum() < MIN_DAYS_PER_YEAR:
            excluded["low_days"] += 1
            continue
        if y[tr].mean() < MIN_MEAN_DAILY_KWH:
            excluded["tiny_load"] += 1
            continue
        dates = y.index
        w_all = ((dates.day_of_week >= 5) | dates.normalize().isin(hol)).astype(float)
        drivers_tr = {"drybulb": W["drybulb"][tr].values, "wetbulb": W["wetbulb"][tr].values}
        best, fits = fit_best(drivers_tr, w_all[tr.values], y[tr].values)
        alt = "drybulb" if best.driver == "wetbulb" else "wetbulb"
        alt_best = min((m for (d, f), m in fits.items() if d == alt), key=lambda m: m.bic)
        x_all = W[best.driver].values
        pred = np.where(ok, best.predict(np.nan_to_num(x_all), w_all), np.nan)
        yv = y.values
        e = yv - pred
        sigma = best.sigma
        z = e / sigma
        z16 = np.where(tr.values, z, np.nan)
        z17 = np.where(te.values, z, np.nan)
        resid16[bid] = z16[tr.values]
        p = best.k
        cv16 = cvrmse(yv[tr.values], pred[tr.values], p)
        nm16 = nmbe(yv[tr.values], pred[tr.values], p)
        cv17 = cvrmse(yv[te.values], pred[te.values], p)
        nm17 = nmbe(yv[te.values], pred[te.values], p)

        # ML comparison: gradient-boosted trees on weather + calendar
        F = gbr_features(dates, W, hol)
        gbr = HistGradientBoostingRegressor(max_iter=150, learning_rate=0.08, max_leaf_nodes=15,
                                            min_samples_leaf=10, random_state=SEED)
        gbr.fit(F[tr.values], yv[tr.values])
        pg = gbr.predict(F[te.values])
        gbr_rows.append((cvrmse(yv[te.values], pg, 1), nmbe(yv[te.values], pg, 1)))
        # Naive: same weekday one year earlier (364 days)
        lag = pd.Series(yv, index=dates).shift(364).values
        m = te.values & ~np.isnan(lag)
        naive_rows.append((cvrmse(yv[m], lag[m], 1), nmbe(yv[m], lag[m], 1)) if m.sum() > 200 else (np.nan, np.nan))

        series[bid] = dict(dates=dates, y=yv, pred=pred, z=z, x=x_all, w=w_all, tr=tr.values, te=te.values,
                           model=best)
        md = meta.loc[bid] if bid in meta.index else None
        plants.append(dict(
            id=bid, site=site,
            use=str(md["primaryspaceusage"]) if md is not None and pd.notna(md["primaryspaceusage"]) else "unknown",
            sqm=float(md["sqm"]) if md is not None and pd.notna(md["sqm"]) else None,
            model=dict(form=best.form, driver=best.driver, cps=best.cps, beta=[float(b) for b in best.beta],
                       r2=best.r2, bic=best.bic, sigma=sigma),
            alt_driver=dict(driver=alt, r2=alt_best.r2, bic=alt_best.bic, form=alt_best.form),
            cv16=cv16, nmbe16=nm16, cv17=cv17, nmbe17=nm17,
            g14_2016=bool(cv16 <= G14_CV and abs(nm16) <= G14_NMBE),
            g14_2017=bool(cv17 <= G14_CV and abs(nm17) <= G14_NMBE),
            mean_daily_kwh_2016=float(np.nanmean(yv[tr.values])),
            z17=z17,
        ))
        sqm = plants[-1]["sqm"]
        inten = plants[-1]["mean_daily_kwh_2016"] * 365 / sqm if sqm else None
        plants[-1].update(dict(
            kwh_per_m2_yr=inten,
            units_ok=bool(inten is not None and inten <= MAX_KWH_PER_M2_YR),
        ))
    log("fitted", len(plants))
    funnel.update({"excluded_" + k: v for k, v in excluded.items()})
    funnel["meters_modelled"] = len(plants)

    # ---- CUSUM threshold: PRD value and a calibration on real autocorrelated residuals
    g14_ids = [p["id"] for p in plants if p["g14_2016"]]
    log("bootstrap ARL0 on", len(g14_ids), "meters")
    boot = {}
    for h in (5.0, 8.0, 10.0, 12.0, 13.0, 14.0, 15.0, 16.0, 17.0, 18.0, 20.0):
        boot[h] = arl_sieve_bootstrap([resid16[i] for i in g14_ids], K_REF, h, reps=20,
                                      horizon=730, seed=SEED)
        log(f"  h={h} ARL0={boot[h]:.0f} d")
    h_cal = next((h for h in sorted(boot) if boot[h] >= 365), max(boot))
    arl_ref = {"iid_arl0_h5": arl_iid(0.0, K_REF, H_PRD, reps=4000, horizon=3000, seed=SEED),
               "iid_arl1_1sigma_h5": arl_iid(1.0, K_REF, H_PRD, reps=4000, horizon=3000, seed=SEED)}

    # ---- Score 2017
    log("score 2017, h_cal =", h_cal)
    queue = []
    alarm_counts = {"h5": {"up": 0, "down": 0, "none": 0}, "hcal": {"up": 0, "down": 0, "none": 0}}
    for p in plants:
        s = series[p["id"]]
        te = s["te"]
        idx17 = np.flatnonzero(te)
        z17 = s["z"][te]
        d17 = s["dates"][te]
        for key, h in (("h5", H_PRD), ("hcal", h_cal)):
            cp, cm = cusum(z17, K_REF, h)
            ia, side, onset = first_alarm(cp, cm, h)
            alarm_counts[key][side or "none"] += 1
            if key == "hcal":
                p["cusum_up"], p["cusum_dn"] = cp, cm
                p["alarm"] = None
                if ia is not None:
                    e17 = (s["y"] - s["pred"])[te]
                    post = slice(onset, None)
                    net = float(np.nansum(e17[post]))
                    x17, w17 = s["x"][te], s["w"][te]
                    kind, contrib, tstat = diagnose(e17[post], x17[post], w17[post], s["model"])
                    if side == "down":
                        kind = "down"
                    # monthly-review comparison: first month-end where actual exceeds model by >10%
                    mdf = pd.DataFrame({"y": s["y"][te], "p": s["pred"][te]}, index=d17).resample("ME").sum()
                    dev = (mdf["y"] - mdf["p"]) / mdf["p"]
                    flag = dev > 0.10 if side == "up" else dev < -0.10
                    flag = flag[flag.index >= d17[onset]]
                    month_flag = flag.index[flag.values][0] if flag.any() else None
                    lead = (month_flag - d17[ia]).days if month_flag is not None else None
                    frac_pos = float(np.mean(e17[ia:] > 0)) if side == "up" else float(np.mean(e17[ia:] < 0))
                    mean_z_post = float(np.nanmean(z17[post]))
                    conf = ("high" if p["cv16"] <= 15 and frac_pos >= 0.65 else
                            "medium" if p["cv16"] <= G14_CV and frac_pos >= 0.55 else "low")
                    # Guideline 14: only a compliant baseline (and plausible units) may be used to size excess
                    p["sizable"] = bool(p["units_ok"] and p["g14_2016"])
                    excess_kwh_th = net if (side == "up" and p["sizable"]) else None
                    p["alarm"] = dict(
                        side=side, date=str(d17[ia].date()), onset=str(d17[onset].date()),
                        days_to_alarm=int(ia - onset), net_residual_kwh_th=net,
                        excess_kwh_th=excess_kwh_th,
                        excess_ton_h=None if excess_kwh_th is None else excess_kwh_th / KWH_PER_TON_HOUR,
                        units_ok=p["units_ok"], sizable=p["sizable"],
                        excess_pct=float(net / np.nansum(s["pred"][te][post]) * 100),
                        kind=kind, check=CHECKS[kind], contrib=contrib, tstat=tstat,
                        month_flag=str(month_flag.date()) if month_flag is not None else None,
                        lead_days_vs_monthly=lead, frac_days_beyond=frac_pos,
                        mean_z_post=mean_z_post, confidence=conf,
                    )
                    if side == "up":
                        queue.append(p)

    sized = sorted([p for p in queue if p["sizable"]], key=lambda p: -p["alarm"]["excess_ton_h"])
    unsized = sorted([p for p in queue if not p["sizable"]], key=lambda p: -p["alarm"]["mean_z_post"])
    queue = sized + unsized
    pos = [max(p["alarm"]["excess_ton_h"], 0) for p in sized]
    up_total = float(sum(pos))
    cum = np.cumsum(pos) / up_total if up_total > 0 else np.array([])
    n_half = int(np.searchsorted(cum, 0.5) + 1) if len(cum) else 0
    n_80 = int(np.searchsorted(cum, 0.8) + 1) if len(cum) else 0

    # ---- Detector check: labelled synthetic steps on meters with no 2017 alarm
    clean_ids = [p for p in plants if p["g14_2016"] and p["alarm"] is None]
    log("injection on", len(clean_ids), "clean meters")
    inj = {}
    for pct in (5, 10, 20):
        det, delays, shifts = 0, [], []
        mdet, mdelays, mfalse = 0, [], 0
        trials = 0
        for p in clean_ids:
            s = series[p["id"]]
            z17 = s["z"][s["te"]].copy()
            meanpred = float(np.nanmean(s["pred"][s["te"]]))
            dz = pct / 100 * meanpred / p["model"]["sigma"]
            for _ in range(4):
                t0 = int(rng.integers(30, 250))
                zz = z17.copy()
                zz[t0:] += dz
                # same trial through the monthly-review rule
                d17 = s["dates"][s["te"]]
                yy = s["y"][s["te"]].copy()
                yy[t0:] += pct / 100 * meanpred
                mdf = pd.DataFrame({"y": yy, "p": s["pred"][s["te"]]}, index=d17).resample("ME").sum()
                mflag = ((mdf["y"] - mdf["p"]) / mdf["p"]) > MONTHLY_RULE
                fired = mflag.index[mflag.values]
                if len(fired) and fired[0] < d17[t0]:
                    mfalse += 1
                else:
                    after = fired[fired >= d17[t0]]
                    if len(after):
                        mdet += 1
                        mdelays.append((after[0] - d17[t0]).days)
                cp, cm = cusum(zz, K_REF, h_cal)
                ia, side, _ = first_alarm(cp, cm, h_cal)
                trials += 1
                shifts.append(dz)
                if ia is not None and side == "up" and ia >= t0:
                    det += 1
                    delays.append(ia - t0)
        inj[str(pct)] = dict(trials=trials, detection_rate=det / trials if trials else None,
                             median_delay_days=float(np.median(delays)) if delays else None,
                             p90_delay_days=float(np.percentile(delays, 90)) if delays else None,
                             median_shift_sigma=float(np.median(shifts)) if shifts else None,
                             monthly_detection_rate=mdet / trials if trials else None,
                             monthly_median_delay_days=float(np.median(mdelays)) if mdelays else None,
                             monthly_false_before_onset=mfalse / trials if trials else None)
    # monthly rule false flags on in-control (2016, G14) residuals, per meter-year
    mf = []
    for i in g14_ids:
        s = series[i]
        mdf = pd.DataFrame({"y": s["y"][s["tr"]], "p": s["pred"][s["tr"]]}, index=s["dates"][s["tr"]]).resample("ME").sum()
        mf.append(int((((mdf["y"] - mdf["p"]) / mdf["p"]) > MONTHLY_RULE).sum()))
    monthly_in_control = dict(mean_flags_per_meter_year=float(np.mean(mf)),
                              share_meters_with_any_flag=float(np.mean(np.array(mf) > 0)))

    # ---- Model comparison summary
    def share(rows):
        a = np.array([r for r in rows if not np.isnan(r[0])])
        return dict(n=int(len(a)), share_g14=float(np.mean((a[:, 0] <= G14_CV) & (np.abs(a[:, 1]) <= G14_NMBE))),
                    median_cv=float(np.median(a[:, 0])), median_abs_nmbe=float(np.median(np.abs(a[:, 1]))))

    cp_rows = [(p["cv17"], p["nmbe17"]) for p in plants]
    cp16_rows = [(p["cv16"], p["nmbe16"]) for p in plants]
    wb_wins = sum(p["model"]["driver"] == "wetbulb" for p in plants)
    wb_r2_gain = [p["model"]["r2"] - p["alt_driver"]["r2"] if p["model"]["driver"] == "wetbulb"
                  else p["alt_driver"]["r2"] - p["model"]["r2"] for p in plants]
    leads = [p["alarm"]["lead_days_vs_monthly"] for p in queue if p["alarm"]["lead_days_vs_monthly"] is not None]
    summary = dict(
        funnel=funnel, clean_stats=clean_stats,
        models={"changepoint_2016_insample": share(cp16_rows), "changepoint_2017": share(cp_rows),
                "gbr_2017": share(gbr_rows), "naive_lastyear_2017": share(naive_rows)},
        forms={f: sum(p["model"]["form"] == f for p in plants) for f in ("2P", "3PC", "4P", "5P")},
        wetbulb_selected=wb_wins, drybulb_selected=len(plants) - wb_wins,
        median_r2_gain_wetbulb_minus_drybulb=float(np.median(wb_r2_gain)),
        cusum=dict(k=K_REF, h_prd=H_PRD, h_used=h_cal, bootstrap_arl0=boot, iid_reference=arl_ref,
                   alarms=alarm_counts),
        queue=dict(n_up=len(queue), n_sized=len(sized), n_unsized=len(unsized), total_excess_ton_h=up_total,
                   total_excess_kwh_elec_at_default=up_total * DEFAULT_KW_PER_TON,
                   plants_for_50pct=n_half, plants_for_80pct=n_80,
                   by_kind={k: sum(p["alarm"]["kind"] == k for p in queue) for k in ("slope", "baseload", "schedule")},
                   median_lead_days_vs_monthly=float(np.median(leads)) if leads else None,
                   n_lead_measured=len(leads),
                   n_monthly_never_flagged=sum(p["alarm"]["lead_days_vs_monthly"] is None for p in queue)),
        monthly_rule_in_control_2016=monthly_in_control,
        units_gate=dict(max_kwh_per_m2_yr=MAX_KWH_PER_M2_YR, plants_units_ok=sum(p["units_ok"] for p in plants),
                        plants_units_suspect=sum(not p["units_ok"] for p in plants),
                        suspect_by_site={st: sum((not p["units_ok"]) and p["site"] == st for p in plants) for st in sorted({p["site"] for p in plants}) if any((not p["units_ok"]) and p["site"] == st for p in plants)}),
        injection=dict(note="Synthetic labelled steps added to real 2017 residuals of meters with a "
                            "Guideline 14 baseline and no 2017 alarm; 4 random onsets per meter.",
                       h=h_cal, results=inj),
        units=dict(kwh_per_ton_hour=KWH_PER_TON_HOUR, default_kw_per_ton=DEFAULT_KW_PER_TON),
    )

    # ---- Export
    def r(v, nd=1):
        return None if v is None or not np.isfinite(float(v)) else round(float(v), nd)

    def finite(o):
        if isinstance(o, dict):
            return {str(k): finite(v) for k, v in o.items()}
        if isinstance(o, (list, tuple)):
            return [finite(v) for v in o]
        if isinstance(o, (float, np.floating)):
            return float(o) if np.isfinite(o) else None
        if isinstance(o, np.integer):
            return int(o)
        return o

    fleet = []
    for p in plants:
        s = series[p["id"]]
        # weekly mean z for the sparkline, 2016-2017
        zw = pd.Series(s["z"], index=s["dates"]).resample("W").mean()
        a = p["alarm"]
        fleet.append(dict(
            id=p["id"], site=p["site"], use=p["use"], form=p["model"]["form"], driver=p["model"]["driver"],
            r2=r(p["model"]["r2"], 3), cv16=r(p["cv16"]), nmbe16=r(p["nmbe16"]), cv17=r(p["cv17"]), nmbe17=r(p["nmbe17"]),
            g14=p["g14_2016"], mean_kwh=r(p["mean_daily_kwh_2016"], 0),
            units_ok=p["units_ok"], kwh_m2=r(p["kwh_per_m2_yr"], 0),
            spark=[r(v, 2) for v in zw.values],
            alarm=None if a is None else dict(
                side=a["side"], date=a["date"], onset=a["onset"], kind=a["kind"],
                excess_ton_h=r(a["excess_ton_h"], 0), excess_pct=r(a["excess_pct"]),
                confidence=a["confidence"], lead=a["lead_days_vs_monthly"], month_flag=a["month_flag"]),
        ))
    detail_ids = [p["id"] for p in queue[:30]] + [p["id"] for p in clean_ids[:5]]
    for p in plants:
        if p["id"] not in detail_ids:
            continue
        s = series[p["id"]]
        te = s["te"]
        cpu = np.full(len(te), np.nan)
        cmd = np.full(len(te), np.nan)
        cpu[te], cmd[te] = p["cusum_up"], p["cusum_dn"]
        doc = dict(
            id=p["id"], model=p["model"], alt_driver=p["alt_driver"], cv16=p["cv16"], nmbe16=p["nmbe16"],
            cv17=p["cv17"], nmbe17=p["nmbe17"], alarm=p["alarm"], h=h_cal, k=K_REF,
            dates=[str(d.date()) for d in s["dates"]],
            y=[r(v, 0) for v in s["y"]], pred=[r(v, 0) for v in s["pred"]],
            x=[r(v, 2) for v in s["x"]], w=[int(v) for v in s["w"]],
            cusum_up=[r(v, 2) for v in cpu], cusum_dn=[r(v, 2) for v in cmd],
        )
        (out_dir / "detail" / f"{p['id']}.json").write_text(json.dumps(finite(doc)))
    (out_dir / "fleet.json").write_text(json.dumps(finite(fleet)))
    (out_dir / "queue.json").write_text(json.dumps(finite([
        dict(rank=i + 1, id=p["id"], site=p["site"], use=p["use"], **{k: (r(v, 2) if isinstance(v, float) else v)
             for k, v in p["alarm"].items() if k not in ("contrib", "tstat")}, cv16=r(p["cv16"]))
        for i, p in enumerate(queue)])))
    (out_dir / "summary.json").write_text(json.dumps(finite(summary), indent=2))
    log("done", json.dumps({k: summary[k] for k in ("models", "queue", "injection")}, default=float)[:2000])


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
