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

Reads package data from a file, calculates a score for each package based on defined thresholds for stars, daily average activity, recent commits, open pull requests etc.
```bash
./score-calculator.sh
```

## `max-influence.sh`
**Requires**: `g++`, `python3`

```bash
./max-influence.sh
```

# Latest results (02.01.26)
```bash
Optimal Seeds: @ngxvoice/ngx-voicelistner @rstacruz/pnpm big-bertha cordova-plugin-amplify-payment fhir2 merino primeng-custom react-native-ok-sdk search-list-react wc-starterkit
```
