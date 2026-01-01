import pandas as pd
import numpy as np
import math
from datetime import datetime
from zoneinfo import ZoneInfo
import matplotlib.pyplot as plt

PARAMS = {
    "downloads": {"k": 0.6, "m": math.log(500 + 1)},
    "stars": {"k": 0.5, "m": math.log(500 + 1)},
    "commit_days": {"k": 0.05, "m": 120},
    "issue_close": {"k": 0.9, "m": math.log(72 + 1)},
    "pr_close": {"k": 0.9, "m": math.log(48 + 1)},
    "issue_open": {"k": 0.8, "m": math.log(168 + 1)},
    "pr_open": {"k": 0.8, "m": math.log(120 + 1)},
    "maint_commits": {"k": 0.8, "m": math.log(50 + 1)},
    "maint_days": {"k": 0.06, "m": 90},
    "max_days_missing": 1000,
}

WEIGHTS_PACKAGE = {
    "downloads": 1.0,
    "commit": 0.6,
    "issues": 0.8,
    "prs": 2,
    "stars": 0.5,
    "maintainers": 1.2,
}

WEIGHTS_USER = {
    "activity_recency": 0.6,
    "contributions": 0.4,
}

EPS = 1e-9
TZ = ZoneInfo("Europe/Berlin")

def logistic(x, k, m):
    return 1.0 / (1.0 + math.exp(-k * (x - m)))

def inv_logistic(x, k, m):
    return 1.0 - logistic(x, k, m)

def safe_log1p(x):
    try:
        return math.log1p(max(float(x), 0.0))
    except Exception:
        return 0.0

def days_since(date_str):
    if pd.isna(date_str) or not date_str:
        return PARAMS["max_days_missing"]
    try:
        dt = pd.to_datetime(date_str)
        if dt.tzinfo is None:
            dt = dt.tz_localize(TZ)
        return max(0.0, (datetime.now(TZ) - dt).days)
    except Exception:
        return PARAMS["max_days_missing"]

def geometric_mean(values, weights):
    prod, wsum = 1.0, 0.0
    for k, w in weights.items():
        v = max(EPS, min(1 - EPS, values[k]))
        prod *= v ** w
        wsum += w
    return float(prod ** (1.0 / wsum))

def valid_package_row(row):
    required = ["pkg_name", "gh_days_since_commit", "avg_daily", "gh_stars"]
    return all(pd.notna(row.get(c)) for c in required)

def valid_user_row(row):
    if pd.isna(row.get("pkg_name")) or pd.isna(row.get("username")):
        return False
    return any(
        pd.notna(row.get(c))
        for c in ["last_activity_at", "last_push_at", "last_contribution_date"]
    )

def score_user(row):
    days = min(
        days_since(row.get("last_activity_at")),
        days_since(row.get("last_push_at")),
        days_since(row.get("last_contribution_date")),
    )

    activity_score = logistic(
        days,
        PARAMS["maint_days"]["k"],
        PARAMS["maint_days"]["m"],
    )

    contrib_score = inv_logistic(
        safe_log1p(row.get("total_contributions", 0)),
        PARAMS["maint_commits"]["k"],
        PARAMS["maint_commits"]["m"],
    )

    return (
        WEIGHTS_USER["activity_recency"] * activity_score
        + WEIGHTS_USER["contributions"] * contrib_score
    )

def score_package(pkg, maint_score):
    scores = {}

    scores["downloads"] = logistic(
        safe_log1p(pkg.get("avg_daily", 0)),
        PARAMS["downloads"]["k"],
        PARAMS["downloads"]["m"],
    )

    scores["commit"] = logistic(
        pkg["gh_days_since_commit"],
        PARAMS["commit_days"]["k"],
        PARAMS["commit_days"]["m"],
    )

    scores["stars"] = inv_logistic(
        safe_log1p(pkg.get("gh_stars", 0)),
        PARAMS["stars"]["k"],
        PARAMS["stars"]["m"],
    )

    scores["issues"] = np.mean([
        logistic(safe_log1p(pkg.get("avg_issue_till_closed", 0)),
                 PARAMS["issue_close"]["k"], PARAMS["issue_close"]["m"]),
        logistic(safe_log1p(pkg.get("avg_issue_open_time", 0)),
                 PARAMS["issue_open"]["k"], PARAMS["issue_open"]["m"]),
    ])

    scores["prs"] = np.mean([
        logistic(safe_log1p(pkg.get("avg_pr_till_closed", 0)),
                 PARAMS["pr_close"]["k"], PARAMS["pr_close"]["m"]),
        logistic(safe_log1p(pkg.get("avg_pr_open_time", 0)),
                 PARAMS["pr_open"]["k"], PARAMS["pr_open"]["m"]),
    ])

    scores["maintainers"] = maint_score

    return geometric_mean(scores, WEIGHTS_PACKAGE)

def visualize(packages):
    plt.figure()
    plt.hist(packages["inactivity_score"], bins=30)
    plt.title("Distribution of Package Inactivity Scores")
    plt.xlabel("Inactivity Score")
    plt.ylabel("Count")
    plt.show()

    top = packages.sort_values("inactivity_score", ascending=False).head(15)
    plt.figure()
    plt.barh(top["pkg_name"], top["inactivity_score"])
    plt.title("Top 15 Most Inactive Packages")
    plt.xlabel("Inactivity Score")
    plt.gca().invert_yaxis()
    plt.show()

def main():
    packages = pd.read_csv("merged.csv")
    users = pd.read_csv("data/users.csv")

    packages = packages[packages.apply(valid_package_row, axis=1)]
    users = users[users.apply(valid_user_row, axis=1)]

    users["user_score"] = users.apply(score_user, axis=1)

    maint_scores = (
        users.groupby("pkg_name")["user_score"]
        .mean()
        .reset_index()
        .rename(columns={"user_score": "maintainers_score"})
    )

    packages = packages.merge(maint_scores, on="pkg_name", how="left")
    packages["maintainers_score"] = packages["maintainers_score"].fillna(1.0)

    print(packages.head(2))
    packages["inactivity_score"] = packages.apply(
    lambda r: score_package(r, r["maintainers_score"]),
    axis=1,
)

    packages.sort_values("inactivity_score", ascending=False).to_csv(
        "package_scores.csv", index=False
    )

    visualize(packages)

    print("Scoring + visualization complete")

if __name__ == "__main__":
    main()
