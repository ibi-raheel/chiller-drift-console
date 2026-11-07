"""Psychrometrics: relative humidity from dew point, and wet-bulb temperature.

All temperatures in degrees C, RH in percent, pressure in kPa.
"""
from __future__ import annotations

import numpy as np

# Magnus coefficients (Alduchov & Eskridge 1996), valid about -40..50 C over water.
MAGNUS_A = 17.625
MAGNUS_B = 243.04


def sat_vapour_pressure(t_c):
    """Saturation vapour pressure over water, kPa (Magnus form)."""
    t_c = np.asarray(t_c, dtype=float)
    return 0.61094 * np.exp(MAGNUS_A * t_c / (MAGNUS_B + t_c))


def rh_from_dewpoint(t_c, td_c):
    """RH (%) = 100 * e_s(Td) / e_s(T). Clipped to [1, 100]."""
    rh = 100.0 * sat_vapour_pressure(td_c) / sat_vapour_pressure(t_c)
    return np.clip(rh, 1.0, 100.0)


def wetbulb_stull(t_c, rh_pct):
    """Stull (2011) empirical wet-bulb at sea-level pressure.

    Tw = T atan(0.151977 (RH + 8.313659)^0.5) + atan(T + RH) - atan(RH - 1.676331)
         + 0.00391838 RH^1.5 atan(0.023101 RH) - 4.686035
    Stated validity: RH 5-99 %, T -20..50 C; error mostly within +-1 C.
    """
    t = np.asarray(t_c, dtype=float)
    rh = np.asarray(rh_pct, dtype=float)
    return (
        t * np.arctan(0.151977 * np.sqrt(rh + 8.313659))
        + np.arctan(t + rh)
        - np.arctan(rh - 1.676331)
        + 0.00391838 * rh ** 1.5 * np.arctan(0.023101 * rh)
        - 4.686035
    )


def wetbulb_psychrometric(t_c: float, rh_pct: float, p_kpa: float = 101.325) -> float:
    """Reference wet-bulb from the psychrometer equation, solved by bisection.

    e = e_s(Tw) - gamma * P * (T - Tw), gamma = 6.6e-4 * (1 + 0.00115 Tw) per C
    (ventilated psychrometer constant). Used to check the Stull fit.
    """
    e = rh_pct / 100.0 * float(sat_vapour_pressure(t_c))
    lo, hi = -40.0, float(t_c)
    for _ in range(80):
        tw = 0.5 * (lo + hi)
        f = float(sat_vapour_pressure(tw)) - 6.6e-4 * (1 + 0.00115 * tw) * p_kpa * (t_c - tw) - e
        if f > 0:
            hi = tw
        else:
            lo = tw
    return 0.5 * (lo + hi)
