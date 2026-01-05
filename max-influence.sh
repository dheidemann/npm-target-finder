#!/usr/bin/env bash

set -euo pipefail

python -m venv venv
source venv/bin/activate
pip install -r src/requirements.txt

python src/flatten-dependencies.py -i data/packages.csv -o data/flattened_dependencies.csv
python src/merge.py --identifier pkg_name --paths data/packages.csv,data/scores.csv --sort_by inactivity_score --output data/all_pkg_max_infl.csv
python src/build-dependency-graph.py -e data/flattened_dependencies.csv -n data/all_pkg_max_infl.csv -o data/graph.gexf

mkdir -p bin
g++ -O3 -fopenmp src/weighted_max_influence.cc -o bin/influence
./bin/influence data/graph.gexf 20 inactivity_score
