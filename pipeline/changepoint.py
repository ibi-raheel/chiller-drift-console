"""ASHRAE Guideline 14 / Inverse Modeling Toolkit style change-point models.

Daily energy E is regressed on an outdoor temperature x (dry-bulb or wet-bulb)
plus a weekend/holiday offset w (0/1):

  2P :  E = b0 + b1 x                         + bw w
  3PC:  E = b0 + b1 (x - c)+                  + bw w
  4P :  E = b0 + b1 (c - x)+ + b2 (x - c)+    + bw w
  5P :  E = b0 + b1 (c1 - x)+ + b2 (x - c2)+  + bw w      (c1 < c2, flat band between)

(u)+ = max(u, 0). Change points are found by grid search; for each candidate the
remaining coefficients are ordinary least squares. The model form is picked by
BIC = n ln(SSE/n) + k ln(n), where k counts slopes, intercepts and change points.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

FORMS = ("2P", "3PC", "4P", "5P")
N_CP = {"2P": 0, "3PC": 1, "4P": 1, "5P": 2}


def design(form: str, x, w, cps) -> np.ndarray:
    x = np.asarray(x, float)
    w = np.asarray(w, float)
    one = np.ones_like(x)
    if form == "2P":
        cols = [one, x, w]
    elif form == "3PC":
        (c,) = cps
        cols = [one, np.maximum(x - c, 0), w]
    elif form == "4P":
        (c,) = cps
        cols = [one, np.maximum(c - x, 0), np.maximum(x - c, 0), w]
    elif form == "5P":
        c1, c2 = cps
        cols = [one, np.maximum(c1 - x, 0), np.maximum(x - c2, 0), w]
    else:
        raise ValueError(form)
    return np.column_stack(cols)


def ols(X: np.ndarray, y: np.ndarray):
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ beta
    return beta, float(resid @ resid)


@dataclass
class CPModel:
    form: str
    driver: str
    cps: tuple
    beta: np.ndarray
    sse: float
    n: int
    k: int
    bic: float
    r2: float
    sigma: float  # residual std (ddof = k)
    extra: dict = field(default_factory=dict)

    def predict(self, x, w):
        return design(self.form, x, w, self.cps) @ self.beta


def _grid(x, n=41, lo=0.05, hi=0.95):
    return np.unique(np.round(np.quantile(x, np.linspace(lo, hi, n)), 3))


def fit_form(form: str, x, w, y, driver: str = "x") -> CPModel:
    x = np.asarray(x, float)
    w = np.asarray(w, float)
    y = np.asarray(y, float)
    n = len(y)
    best = None
    if N_CP[form] == 0:
        cands = [()]
    elif N_CP[form] == 1:
        cands = [(c,) for c in _grid(x)]
    else:
        g = _grid(x, 25)
        cands = [(a, b) for i, a in enumerate(g) for b in g[i + 1:]]
    for cps in cands:
        X = design(form, x, w, cps)
        beta, sse = ols(X, y)
        # physical sanity: cooling slope must be non-negative
        if form in ("3PC", "4P", "5P") and beta[-2] < 0:
            continue
        if best is None or sse < best[2]:
            best = (cps, beta, sse)
    if best is None:  # fall back to the unconstrained 2P
        return fit_form("2P", x, w, y, driver)
    cps, beta, sse = best
    k = len(beta) + N_CP[form]
    sst = float(((y - y.mean()) ** 2).sum())
    bic = n * np.log(max(sse, 1e-12) / n) + k * np.log(n)
    return CPModel(
        form=form, driver=driver, cps=tuple(float(c) for c in cps), beta=beta, sse=sse, n=n, k=k,
        bic=float(bic), r2=1 - sse / sst if sst > 0 else 0.0,
        sigma=float(np.sqrt(sse / max(n - k, 1))),
    )


def fit_best(drivers: dict, w, y) -> tuple[CPModel, dict]:
    """Fit every form for every driver; return the lowest-BIC model and all fits."""
    fits = {}
    for dname, x in drivers.items():
        for form in FORMS:
            fits[(dname, form)] = fit_form(form, x, w, y, dname)
    best = min(fits.values(), key=lambda m: m.bic)
    return best, fits


def cvrmse(y, yhat, p: int = 1) -> float:
    """ASHRAE Guideline 14 CV(RMSE), percent."""
    y = np.asarray(y, float)
    e = y - np.asarray(yhat, float)
    return float(100 * np.sqrt((e @ e) / (len(y) - p)) / y.mean())


def nmbe(y, yhat, p: int = 1) -> float:
    """ASHRAE Guideline 14 NMBE, percent (positive = model under-predicts)."""
    y = np.asarray(y, float)
    e = y - np.asarray(yhat, float)
    return float(100 * e.sum() / ((len(y) - p) * y.mean()))
