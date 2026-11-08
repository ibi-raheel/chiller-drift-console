"""drift_check CLI: reproduces the published queue from the real BDG2 files.

The BDG2 files live outside the repository; set BDG2_DIR to the folder with
chilledwater_cleaned.csv, weather.csv and metadata.csv. Tests skip when it is absent.
"""
import json
import os
from pathlib import Path

import pandas as pd
import pytest

from tools.drift_check import main, run

ROOT = Path(__file__).resolve().parent.parent
BDG2 = Path(os.environ.get("BDG2_DIR", ROOT.parent / "_downloads" / "bdg2"))
QUEUE = json.loads((ROOT / "public" / "data" / "queue.json").read_text())
SUMMARY = json.loads((ROOT / "public" / "data" / "summary.json").read_text())
need_data = pytest.mark.skipif(not (BDG2 / "chilledwater_cleaned.csv").exists(), reason="BDG2 files not present")


@need_data
def test_real_slice_matches_published_queue(tmp_path):
    """Three real meters (the top two of the queue and one in-control plant) through the CLI."""
    ids = ["Fox_education_Louie", "Fox_assembly_Emma", "Fox_education_Shirley"]
    main(["--meters", str(BDG2 / "chilledwater_cleaned.csv"), "--weather", str(BDG2 / "weather.csv"),
          "--metadata", str(BDG2 / "metadata.csv"), "--only", ",".join(ids), "--out", str(tmp_path)])
    q = pd.read_csv(tmp_path / "queue.csv").set_index("plant")
    for pub in QUEUE[:2]:
        r = q.loc[pub["id"]]
        assert r["onset"] == pub["onset"] and r["alarm"] == pub["date"]
        assert r["excess_ton_h"] == pytest.approx(pub["excess_ton_h"], abs=1)
        assert r["pattern"] == pub["kind"] and r["label"] == "real, investigate"
    assert q.loc["Fox_education_Louie", "rank"] == 1
    assert q.loc["Fox_education_Shirley", "label"] == "in control"
    assert (tmp_path / "summary.md").read_text().startswith("# Drift check")


@need_data
def test_full_fleet_calibrates_h16_and_reproduces_summary():
    rows, s = run(pd.read_csv(BDG2 / "chilledwater_cleaned.csv", parse_dates=["timestamp"], index_col="timestamp"),
                  pd.read_csv(BDG2 / "weather.csv", parse_dates=["timestamp"]),
                  pd.read_csv(BDG2 / "metadata.csv"), do_calibrate=True)
    assert s["h"] == SUMMARY["cusum"]["h_used"] == 16.0
    assert s["n_plants"] == SUMMARY["funnel"]["meters_modelled"]
    assert s["n_up"] == SUMMARY["cusum"]["alarms"]["hcal"]["up"]
    assert s["plants_for_50pct"] == SUMMARY["queue"]["plants_for_50pct"] == 8
    assert s["total_ton_h"] == pytest.approx(SUMMARY["queue"]["total_excess_ton_h"], rel=1e-6)
    assert [r["plant"] for r in rows[:8]] == [r["id"] for r in QUEUE[:8]]
