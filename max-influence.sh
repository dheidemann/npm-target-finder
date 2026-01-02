#!/usr/bin/env bash

set -euo pipefail

python -m venv venv
source venv/bin/activate
pip install -r src/requirements.txt
pip install PyQt6

python flatten-dependencies.py -i data/packages.csv -o data/flattened_dependencies.csv
python merge.py --identifier pkg_name --paths data/packages.csv,data/package_scores.csv --sort_by inactivity_score --output all_pkg_max_infl.csv
python build-dependency-graph.py -e data/flattened_dependencies.csv -n data/all_pkg_max_infl.csv -o data/graph

mkdir -p bin
g++ -O3 -fopenmp src/weighted_max_influence.cc -o bin/influence
./bin/influence src/data/graph.gexf 10 inactivity_score
