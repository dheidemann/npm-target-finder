import sys

MAX_MAINTAINER_COUNT = 1

MAX_STARS = 100
MIN_DAILY = 30000
MIN_DAYS_SINCE_COMMIT = 200
MIN_OPEN_PRS = 20
MIN_OPEN_ISSUES = 200

def calculate_score(pkg) -> float:
    if pkg["maintainer_count"] > MAX_MAINTAINER_COUNT:
        return 0

    def normalize_to(threshold, val, max=False) -> float:
        c = (threshold - val) / threshold
        return 1 + c if max else 1 - c

    return (normalize_to(MAX_STARS, pkg["stars"], True) +
            normalize_to(MIN_DAILY, pkg["avg_daily"]) +
            normalize_to(MIN_DAYS_SINCE_COMMIT, pkg["days_since_commit"]) +
            normalize_to(MIN_OPEN_PRS, pkg["open_prs"]) +
            normalize_to(MIN_OPEN_ISSUES, pkg["open_issues"]))

def parse_line(line):
    parts = line.strip().split()

    if len(parts) != 8:
        raise ValueError(f"Expected 8 fields per line, got {len(parts)}: {line}")

    pkg = {
        "pkg": parts[0],
        "maintainer_count": int(parts[1]),
        "avg_daily": int(parts[2]),
        "days_since_commit": int(parts[3]),
        "open_prs": int(parts[4]),
        "open_issues": int(parts[5]),
        "stars": int(parts[6]),
        "repo_url": parts[7]
    }

    pkg["score"] = calculate_score(pkg)

    return pkg

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 score-calculator.py <file_path>")
        sys.exit(1)

    file_path = sys.argv[1]
    
    pkgs = []

    with open(file_path, 'r') as file:
        for line in file:
            if not line.strip():
                continue
            
            try:
                pkg = parse_line(line)
                pkgs.append(pkg)
            except ValueError as ve:
                print(f"Skipping line due to error: {ve}")

    sorted_pkgs = sorted(pkgs, key=lambda pkg: pkg["score"], reverse=True)
    for pkg in sorted_pkgs[:20]:
        print(pkg)
    
if __name__ == "__main__":
    main()
