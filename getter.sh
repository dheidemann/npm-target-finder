#!/usr/bin/env bash

set -euo pipefail

GH_TOKEN=$1

mkdir -p src/data
GITHUB_TOKEN=$GH_TOKEN node src/fetch-gh-pkgs.js --output data/packages.csv --include-github
GITHUB_TOKEN=$GH_TOKEN node src/fetch-maintainer-data.js data/packages.csv data/users.csv
node src/fetch-gh-avg-open.js data/packages.csv data/avg_open.csv --token=$GH_TOKEN
