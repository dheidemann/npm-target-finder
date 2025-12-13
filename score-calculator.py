#!/usr/bin/env python3

import pandas as pd, math, numpy as np
from datetime import datetime
from zoneinfo import ZoneInfo

csv_path = "/mnt/data/packages_example.csv"

PARAMS = {
    "downloads": {"k": 0.6, "m": math.log(5000+1)},
    "commit_age_days": {"k": 0.05, "m": 120.0},
    "close_time_log": {"k": 1.0, "m": math.log(100+1)},
    "open_time_log": {"k": 0.7, "m": math.log(200+1)},
    "stars": {"k": 0.5, "m": math.log(500+1)},
    "maint_commits_log": {"k": 0.8, "m": math.log(50+1)},
    "maint_activity_days": {"k": 0.06, "m": 90.0},
    "weights": {
        "downloads": 1.0,
        "commit_age": 1.0,
        "close_time": 0.6,
        "open_time": 0.8,
        "stars": 0.5,
        "maintainers": 1.2,
    },
    "max_days_for_missing_date": 1000,
}

def logistic(x: float, k: float, m: float) -> float:
    try:
        z = -k * (x - m)
        if z >= 0:
            ez = math.exp(-z)
            return 1.0 / (1.0 + ez)
        else:
            ez = math.exp(z)
            return ez / (1.0 + ez)
    except OverflowError:
        return 0.0 if -k*(x-m) > 0 else 1.0

def safe_log1p(x):
    try:
        if x is None or (isinstance(x, float) and math.isnan(x)):
            return 0.0
        v = float(x)
        if v <= 0.0:
            return 0.0
        return math.log1p(v)
    except Exception:
        return 0.0

def days_since(date_str, tz_local=ZoneInfo("Europe/Berlin")):
    if pd.isna(date_str) or date_str is None or date_str == "":
        return PARAMS["max_days_for_missing_date"]
    formats = [
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%d",
    ]
    parsed = None
    for fmt in formats:
        try:
            parsed = datetime.strptime(date_str, fmt)
            break
        except Exception:
            continue
    if parsed is None:
        try:
            parsed = pd.to_datetime(date_str, utc=False)
            if parsed.tzinfo is None:
                parsed = parsed.to_pydatetime()
        except Exception:
            return PARAMS["max_days_for_missing_date"]
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ZoneInfo("Europe/Berlin"))
    today = datetime.now(tz=ZoneInfo("Europe/Berlin"))
    delta = today - parsed
    return max(0.0, delta.total_seconds() / 86400.0)

def score_package(row):
    downloads = row.get("daily_pulls", 0)
    x_downloads = safe_log1p(downloads)
    sd = logistic(x_downloads, PARAMS["downloads"]["k"], PARAMS["downloads"]["m"])
    downloads_score = 1.0 - sd

    commit_days = days_since(row.get("last_github_commit_at"))
    commit_score = logistic(commit_days, PARAMS["commit_age_days"]["k"], PARAMS["commit_age_days"]["m"])

    close_hours = row.get("avg_hours_to_close", None)
    x_close = safe_log1p(close_hours)
    close_score = logistic(x_close, PARAMS["close_time_log"]["k"], PARAMS["close_time_log"]["m"])

    open_hours = row.get("avg_hours_open", None)
    x_open = safe_log1p(open_hours)
    open_score = logistic(x_open, PARAMS["open_time_log"]["k"], PARAMS["open_time_log"]["m"])

    stars = row.get("github_stars", 0)
    x_stars = safe_log1p(stars)
    stars_score = 1.0 - logistic(x_stars, PARAMS["stars"]["k"], PARAMS["stars"]["m"])

    maint_scores = []
    for i in range(1, 4):
        commits_col = f"maint{i}_commits_1y"
        last_act_col = f"maint{i}_last_activity_at"
        commits = row.get(commits_col, 0)
        commits_log = safe_log1p(commits)
        commits_component = 1.0 - logistic(commits_log, PARAMS["maint_commits_log"]["k"], PARAMS["maint_commits_log"]["m"])
        maint_days = days_since(row.get(last_act_col))
        activity_component = logistic(maint_days, PARAMS["maint_activity_days"]["k"], PARAMS["maint_activity_days"]["m"])
        maint_score = 0.4 * commits_component + 0.6 * activity_component
        maint_scores.append(maint_score)
    maintainers_score = np.mean(maint_scores)

    weights = PARAMS["weights"]
    components = {
        "downloads": downloads_score,
        "commit_age": commit_score,
        "close_time": close_score,
        "open_time": open_score,
        "stars": stars_score,
        "maintainers": maintainers_score,
    }
    eps = 1e-9
    prod = 1.0
    sum_w = 0.0
    for name, w in weights.items():
        val = float(components[name])
        val = max(eps, min(1.0 - eps, val))
        prod *= val ** w
        sum_w += w
    geom_mean = prod ** (1.0 / sum_w)
    return {
        "downloads_score": downloads_score,
        "commit_score": commit_score,
        "close_score": close_score,
        "open_score": open_score,
        "stars_score": stars_score,
        "maintainers_score": maintainers_score,
        "inactivity_score": geom_mean,
    }

# Read CSV and apply scoring
df = pd.read_csv(csv_path)
numeric_cols = ["daily_pulls", "avg_hours_to_close", "avg_hours_open", "github_stars",
                "maint1_commits_1y", "maint2_commits_1y", "maint3_commits_1y"]
for c in numeric_cols:
    if c in df.columns:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)

rows_out = []
for _, row in df.iterrows():
    s = score_package(row)
    out = row.to_dict()
    out.update(s)
    rows_out.append(out)
out_df = pd.DataFrame(rows_out)
out_csv_path = "/mnt/data/packages_with_scores.csv"
out_df.to_csv(out_csv_path, index=False)

import caas_jupyter_tools as cjt; cjt.display_dataframe_to_user("Package inactivity scores", out_df)
print(f"Saved scored results to: {out_csv_path}")
