#!/usr/bin/env bash

set -euo pipefail

python -m venv venv
source venv/bin/activate
pip install -r src/requirements.txt
pip install PyQt6

python src/merge.py --identifier pkg_name --paths data/gh_packages.csv,data/packages.csv,data/avg_open.csv --sort_by avg_daily --output data/pkg_data.csv
python src/score-calculator.py -p data/pkg_data.csv -u data/users.csv -o data/scores.csv
