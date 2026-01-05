The goal is to find packages that are sitting unnoticed deep down the dependency tree and are therefore potential targets for supply chain attacks.

`npm-target-finder` is essentially a combination of three scripts to fetch data and evaluate the results:

> [!TIP]
> All my gathered and processed data lays in this repo. The scripts are therefore usable in no particular order. The data partially gets overwritten when you execute one of the scripts. To restore original data use `git restore <file>`.

## `getter.sh`
**Requires**: `node`

Fetches package statistics from GitHub and NPM as well as contributor statitistics from packages with GitHub upstream. Provide a personal access token (pat) from GitHub to increase the rate limit.
```bash
./getter.sh pat_xxxx
```

## `score-calculator.sh`
**Requires**: `python3`

Reads package data from a file, calculates a score for each package based on defined thresholds for stars, daily average activity, recent commits, open pull requests etc. To modify the scoring values and weights, please refer to [src/score-calculator.py](src/score-calculator.py).
```bash
./score-calculator.sh
```

## `max-influence.sh`
**Requires**: `g++`, `python3`

> [!TIP]
> To visually explore the graph or do different computations you can manually generate the graph by simply running `./src/build-dependency-graph.py -e data/flattened_dependencies.csv -n data/all_pkg_max_infl.csv --min_avg_daily 1000 --reverse`. Providing the `min_avg_daily` flag drastically reduces the graph size to the more relevant ones. This is especially good if you want to visualize the dependency graph.

```bash
./max-influence.sh
```

# Latest results from maximum influence algorithm (02.01.26)
```bash
omni-common-ui (Val: 0.259505) | Marginal Gain: 5.95825 | Total Weighted Reach: 5.95825
gatsby (Val: 0.150692) | Marginal Gain: 4.31177 | Total Weighted Reach: 10.27
ember-cli (Val: 0.240798) | Marginal Gain: 3.40759 | Total Weighted Reach: 13.6776
simplyimport (Val: 0.536446) | Marginal Gain: 3.43395 | Total Weighted Reach: 17.1116
lerna (Val: 0.189325) | Marginal Gain: 2.69288 | Total Weighted Reach: 19.8044
browserify (Val: 0.552429) | Marginal Gain: 2.65603 | Total Weighted Reach: 22.4605
metro-bundler (Val: 0.157122) | Marginal Gain: 2.13659 | Total Weighted Reach: 24.5971
typings-core (Val: 0.57681) | Marginal Gain: 2.03638 | Total Weighted Reach: 26.6334
composer-rest-server (Val: 0.533018) | Marginal Gain: 2.05135 | Total Weighted Reach: 28.6848
sails (Val: 0.2888) | Marginal Gain: 1.94432 | Total Weighted Reach: 30.6291
gcloud (Val: 0.173477) | Marginal Gain: 2.00149 | Total Weighted Reach: 32.6306
react-styleguidist (Val: 0.26148) | Marginal Gain: 1.90455 | Total Weighted Reach: 34.5351
firebase-tools (Val: 0.179346) | Marginal Gain: 1.91501 | Total Weighted Reach: 36.4501
@kadira/storybook (Val: 0.1599) | Marginal Gain: 1.85237 | Total Weighted Reach: 38.3025
spincycle (Val: 0.442704) | Marginal Gain: 1.81344 | Total Weighted Reach: 40.116
laravel-elixir (Val: 0.398485) | Marginal Gain: 1.7407 | Total Weighted Reach: 41.8567
gitbook (Val: 0.132704) | Marginal Gain: 1.75707 | Total Weighted Reach: 43.6137
node-libs-browser (Val: 0.645156) | Marginal Gain: 1.76318 | Total Weighted Reach: 45.3769
gulp-util (Val: 0.631826) | Marginal Gain: 1.6164 | Total Weighted Reach: 46.9933
postcss-cssnext (Val: 0.436623) | Marginal Gain: 1.65652 | Total Weighted Reach: 48.6498
```
