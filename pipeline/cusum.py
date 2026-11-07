"""Two-sided tabular CUSUM on standardized residuals (Page 1954; Montgomery ch. 9).

  C+_t = max(0, z_t - k + C+_{t-1})
  C-_t = max(0, -z_t - k + C-_{t-1})
  alarm when C+ > h or C- > h.

z_t = (actual - predicted) / sigma_baseline. k and h are in sigma units.
The onset estimate is the last day the alarming statistic was zero before the alarm.
"""
from __future__ import annotations

import numpy as np


def cusum(z, k: float = 0.5, h: float = 5.0):
    z = np.asarray(z, float)
    cp = np.zeros(len(z))
    cm = np.zeros(len(z))
    a, b = 0.0, 0.0
    for i, v in enumerate(z):
        if np.isnan(v):  # hold through missing days
            cp[i], cm[i] = a, b
            continue
        a = max(0.0, v - k + a)
        b = max(0.0, -v - k + b)
        cp[i], cm[i] = a, b
    return cp, cm


def first_alarm(cp, cm, h: float = 5.0):
    """Return (index, side, onset_index) of the first alarm, or (None, None, None)."""
    up = np.flatnonzero(cp > h)
    dn = np.flatnonzero(cm > h)
    iu = up[0] if len(up) else None
    idn = dn[0] if len(dn) else None
    if iu is None and idn is None:
        return None, None, None
    if idn is None or (iu is not None and iu <= idn):
        idx, side, stat = int(iu), "up", cp
    else:
        idx, side, stat = int(idn), "down", cm
    zeros = np.flatnonzero(stat[: idx + 1] == 0)
    onset = int(zeros[-1] + 1) if len(zeros) else 0
    return idx, side, onset


def run_length(z, k=0.5, h=5.0) -> int | None:
    """Days until the first alarm (1-based), or None if no alarm."""
    cp, cm = cusum(z, k, h)
    idx, _, _ = first_alarm(cp, cm, h)
    return None if idx is None else idx + 1


def arl_iid(shift: float, k=0.5, h=5.0, two_sided=True, reps=2000, horizon=5000, seed=0) -> float:
    """Average run length on iid N(shift, 1) data, vectorized over replications."""
    rng = np.random.default_rng(seed)
    a = np.zeros(reps)
    b = np.zeros(reps)
    rl = np.full(reps, horizon, float)
    alive = np.ones(reps, bool)
    for t in range(horizon):
        z = rng.standard_normal(reps) + shift
        a = np.maximum(0, z - k + a)
        b = np.maximum(0, -z - k + b)
        hit = alive & ((a > h) | (b > h) if two_sided else (a > h))
        rl[hit] = t + 1
        alive &= ~hit
        if not alive.any():
            break
    return float(rl.mean())


def run_lengths(Z: np.ndarray, k=0.5, h=5.0) -> np.ndarray:
    """Vectorized first-alarm time (1-based) for each row of Z; horizon if no alarm."""
    reps, horizon = Z.shape
    a = np.zeros(reps)
    b = np.zeros(reps)
    rl = np.full(reps, horizon, float)
    alive = np.ones(reps, bool)
    for t in range(horizon):
        a = np.maximum(0, Z[:, t] - k + a)
        b = np.maximum(0, -Z[:, t] - k + b)
        hit = alive & ((a > h) | (b > h))
        rl[hit] = t + 1
        alive &= ~hit
        if not alive.any():
            break
    return rl


def ar1_fit(r: np.ndarray) -> tuple[float, np.ndarray]:
    """Lag-1 autoregression on a standardized series: phi and the innovations."""
    r = r[~np.isnan(r)]
    z = (r - r.mean()) / r.std()
    phi = float(np.clip((z[1:] @ z[:-1]) / (z[:-1] @ z[:-1]), -0.95, 0.95))
    u = z[1:] - phi * z[:-1]
    return phi, u - u.mean()


def arl_sieve_bootstrap(resids: list[np.ndarray], k=0.5, h=5.0, reps=40, horizon=730,
                        seed=0) -> float:
    """In-control ARL on real residuals with their autocorrelation kept (AR(1) sieve bootstrap).

    For each series: standardize, fit z_t = phi z_{t-1} + u_t, then simulate new series
    from phi with innovations resampled (with replacement) from the real u_t, scaled so the
    simulated series has unit variance. A moving-block bootstrap was tried first and rejected:
    with a 730-day horizon drawn from 366 days it can only replay runs present in the sample,
    which inflated ARL0 on iid noise from 465 to 855 (see METHOD.md).
    Runs with no alarm inside `horizon` count as `horizon`, so the result is a lower bound.
    """
    rng = np.random.default_rng(seed)
    rows = []
    for r in resids:
        if np.sum(~np.isnan(r)) < 60:
            continue
        phi, u = ar1_fit(r)
        scale = np.sqrt(1 - phi ** 2) / u.std()
        U = rng.choice(u, size=(reps, horizon)) * scale
        Z = np.empty_like(U)
        Z[:, 0] = rng.standard_normal(reps)
        for t in range(1, horizon):
            Z[:, t] = phi * Z[:, t - 1] + U[:, t]
        rows.append(Z)
    return float(run_lengths(np.vstack(rows), k, h).mean())
