import numpy as np
import pandas as pd
import pytest

from pipeline.changepoint import cvrmse, design, fit_best, fit_form, nmbe
from pipeline.clean import clean_hourly, to_daily
from pipeline.cusum import arl_sieve_bootstrap, arl_iid, cusum, first_alarm
from pipeline.psychro import rh_from_dewpoint, wetbulb_psychrometric, wetbulb_stull


# ---------- psychrometrics ----------
def test_stull_matches_chart_value():
    # Psychrometric chart, sea level: 20 C dry-bulb, 50 % RH -> wet-bulb about 13.7 C
    assert abs(float(wetbulb_stull(20.0, 50.0)) - 13.7) < 0.3


def test_stull_vs_psychrometer_equation_grid():
    errs = [abs(float(wetbulb_stull(t, rh)) - wetbulb_psychrometric(t, rh))
            for t in range(5, 41, 5) for rh in range(20, 96, 15)]
    assert max(errs) < 1.0


def test_rh_from_dewpoint():
    assert float(rh_from_dewpoint(25.0, 25.0)) == pytest.approx(100.0)
    # 30 C with 20 C dew point is about 55 % RH
    assert abs(float(rh_from_dewpoint(30.0, 20.0)) - 55.2) < 1.0


# ---------- change-point models ----------
def _synthetic(cp=18.0, b0=1000.0, b1=80.0, bw=-150.0, noise=0.0, n=366, seed=1):
    rng = np.random.default_rng(seed)
    x = rng.uniform(-5, 30, n)
    w = (np.arange(n) % 7 >= 5).astype(float)
    y = b0 + b1 * np.maximum(x - cp, 0) + bw * w + noise * rng.standard_normal(n)
    return x, w, y


def test_hand_calc_ols_equals_fit():
    """The 3PC fit reproduces closed-form OLS (normal equations) at its change point."""
    x, w, y = _synthetic(noise=40.0)
    m = fit_form("3PC", x, w, y)
    X = design("3PC", x, w, m.cps)
    beta_hand = np.linalg.solve(X.T @ X, X.T @ y)
    np.testing.assert_allclose(m.beta, beta_hand, atol=1e-6, rtol=0)


def test_recovers_change_point_and_slope():
    x, w, y = _synthetic(cp=18.0, b1=80.0, noise=0.0)
    m = fit_form("3PC", x, w, y)
    assert abs(m.cps[0] - 18.0) < 1.0
    assert abs(m.beta[1] - 80.0) < 4.0


def test_bic_prefers_true_form():
    x, w, y = _synthetic(noise=30.0)
    best, _ = fit_best({"x": x}, w, y)
    assert best.form in ("3PC", "4P", "5P")
    xl, wl, _ = _synthetic()
    y_lin = 500 + 20 * xl + np.random.default_rng(3).normal(0, 30, len(xl))
    best_lin, _ = fit_best({"x": xl}, wl, y_lin)
    assert best_lin.form == "2P"


def test_g14_metrics_hand_values():
    y = np.array([10.0, 12.0, 14.0, 16.0])
    yhat = np.array([11.0, 11.0, 15.0, 15.0])
    # y - yhat = -1, 1, -1, 1 ; SSE = 4 ; mean(y) = 13
    assert cvrmse(y, yhat, p=1) == pytest.approx(100 * np.sqrt(4 / 3) / 13)
    assert nmbe(y, yhat, p=1) == pytest.approx(0.0)


# ---------- CUSUM ----------
def test_cusum_hand_trace():
    z = np.array([0.0, 2.0, 2.0, 2.0, 2.0])
    cp, cm = cusum(z, k=0.5, h=4.0)
    np.testing.assert_allclose(cp, [0.0, 1.5, 3.0, 4.5, 6.0])
    idx, side, onset = first_alarm(cp, cm, h=4.0)
    assert (idx, side, onset) == (3, "up", 1)


def test_cusum_arl_matches_published_tables():
    # Montgomery, Intro to SQC, Table 9.3 (tabular CUSUM, k=0.5, h=5): ARL0 = 465, ARL(1 sigma) = 10.4.
    arl0 = arl_iid(0.0, 0.5, 5.0, two_sided=True, reps=4000, horizon=4000, seed=11)
    arl1 = arl_iid(1.0, 0.5, 5.0, two_sided=True, reps=4000, horizon=500, seed=12)
    assert abs(arl0 - 465) / 465 < 0.05
    assert abs(arl1 - 10.4) / 10.4 < 0.05


def test_bootstrap_arl_iid_noise_is_close_to_theory():
    rng = np.random.default_rng(5)
    res = [rng.standard_normal(366) for _ in range(30)]
    arl = arl_sieve_bootstrap(res, 0.5, 5.0, reps=20, horizon=2000, seed=1)
    assert 380 < arl < 560


def test_autocorrelation_shortens_arl():
    rng = np.random.default_rng(6)
    res = []
    for _ in range(30):
        e = np.zeros(366)
        for t in range(1, 366):
            e[t] = 0.7 * e[t - 1] + rng.standard_normal()
        res.append(e)
    assert arl_sieve_bootstrap(res, 0.5, 5.0, reps=20, horizon=2000, seed=1) < 120


# ---------- cleaning ----------
def test_cleaning_removes_spike_and_flat_run():
    idx = pd.date_range("2016-01-01", periods=24 * 6, freq="h")
    base = 100 + 10 * np.sin(np.arange(len(idx)) / 24 * 2 * np.pi)
    df = pd.DataFrame({"m": base}, index=idx)
    df.iloc[30, 0] = 5000.0          # spike
    df.iloc[72:100, 0] = 123.0       # stuck for 28 h
    out, stats = clean_hourly(df)
    assert np.isnan(out.iloc[30, 0])
    assert out.iloc[72:100, 0].isna().all()
    assert stats["spike_hours"] >= 1 and stats["flat_run_hours"] == 28
    d = to_daily(out)
    assert d.iloc[0, 0] == pytest.approx(base[:24].sum(), rel=1e-9)
    assert np.isnan(d.iloc[3, 0])    # day 4 has only 4 valid hours
