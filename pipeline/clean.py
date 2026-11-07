"""Hourly meter cleaning and daily aggregation."""
from __future__ import annotations

import numpy as np
import pandas as pd


def flat_run_mask(df: pd.DataFrame, min_len: int = 24) -> pd.DataFrame:
    """True where a non-zero value repeats unchanged for >= min_len hours (stuck meter)."""
    same = df.eq(df.shift())
    grp = (~same).cumsum()
    out = pd.DataFrame(False, index=df.index, columns=df.columns)
    for c in df.columns:
        s = df[c]
        sizes = s.groupby(grp[c]).transform("size")
        out[c] = (sizes >= min_len) & s.notna() & (s != 0)
    return out


def hampel_mask(df: pd.DataFrame, window: int = 25, n_sigma: float = 6.0) -> pd.DataFrame:
    """True where |x - rolling median| > n_sigma * 1.4826 * rolling MAD (spikes)."""
    med = df.rolling(window, center=True, min_periods=window // 2).median()
    mad = (df - med).abs().rolling(window, center=True, min_periods=window // 2).median()
    thr = n_sigma * 1.4826 * mad
    return (df - med).abs().gt(thr) & mad.gt(0)


def clean_hourly(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    neg = df.lt(0)
    flat = flat_run_mask(df)
    spike = hampel_mask(df)
    bad = neg | flat | spike
    stats = {
        "negative_hours": int(neg.values.sum()),
        "flat_run_hours": int(flat.values.sum()),
        "spike_hours": int(spike.values.sum()),
    }
    return df.mask(bad), stats


def to_daily(df: pd.DataFrame, min_hours: int = 20) -> pd.DataFrame:
    """Daily sum, scaled by 24/n_valid; NaN where fewer than min_hours valid hours."""
    s = df.resample("D").sum(min_count=1)
    n = df.resample("D").count()
    out = s * 24.0 / n.replace(0, np.nan)
    return out.where(n >= min_hours)
