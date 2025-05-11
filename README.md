The goal is to find packages that are sitting unnoticed deep down the dependency tree and are therefore potential targets for supply chain attacks.

`npm-target-finder` is essentially a combination of two simple scripts:

## `getter.js`
Fetches npm packages with an upstream github url and parse metadata in `packages.txt`:
- Package name
- Maintainer count
- Average daily pulls
- Days since last github commit
- Open PRs count
- Open Issues count
- Github star count

In the script you can define a threshold for minimal daily pulls. It is set to 1000 per default.

## `score-calculator.py`
Reads package data from a file, calculates a score for each package based on defined thresholds for stars, daily average activity, recent commits, open pull requests, and open issues, and then outputs the top 20 packages sorted by their scores.

To configure the script, adjust the threshold values at the top.

# Installation

> [!TIP]
> Last time I ran this script it took approximately 5h to get the packages you can find in `packages.txt`. If you just want to play with the scores I suggest to use the python script below on the provided `packages.txt`.

`getter.js`
```bash
npm i
export GITHUB_TOKEN=gh_XXXXX # optional: provide a gh-token for higher rate limits
node getter.js
```

`score-calculator.py`
```bash
python3 score-calculator.py packages.txt
```

# Latest results (11.05.25)
```bash
{'pkg': 'inherits', 'maintainer_count': 1, 'avg_daily': 1078414, 'days_since_commit': 571, 'open_prs': 2, 'open_issues': 4, 'stars': 353, 'repo_url': 'https://github.com/isaacs/inherits', 'score': 37.392133333333334}
{'pkg': 'isarray', 'maintainer_count': 1, 'avg_daily': 1026857, 'days_since_commit': 198, 'open_prs': 1, 'open_issues': 1, 'stars': 133, 'repo_url': 'https://github.com/juliangruber/isarray', 'score': 35.94356666666667}
{'pkg': 'isstream', 'maintainer_count': 1, 'avg_daily': 383899, 'days_since_commit': 3419, 'open_prs': 0, 'open_issues': 1, 'stars': 63, 'repo_url': 'https://github.com/rvagg/isstream', 'score': 31.26663333333333}
{'pkg': 'graceful-readlink', 'maintainer_count': 1, 'avg_daily': 392365, 'days_since_commit': 3055, 'open_prs': 0, 'open_issues': 0, 'stars': 9, 'repo_url': 'https://github.com/zhiyelee/graceful-readlink', 'score': 30.263833333333334}
{'pkg': 'util-deprecate', 'maintainer_count': 1, 'avg_daily': 482551, 'days_since_commit': 2372, 'open_prs': 0, 'open_issues': 1, 'stars': 38, 'repo_url': 'https://github.com/TooTallNate/util-deprecate', 'score': 29.570033333333335}
{'pkg': 'mkdirp', 'maintainer_count': 1, 'avg_daily': 781527, 'days_since_commit': 602, 'open_prs': 0, 'open_issues': 1, 'stars': 193, 'repo_url': 'https://github.com/isaacs/node-mkdirp', 'score': 29.135899999999996}
{'pkg': 'imurmurhash', 'maintainer_count': 1, 'avg_daily': 196020, 'days_since_commit': 4276, 'open_prs': 0, 'open_issues': 0, 'stars': 99, 'repo_url': 'https://github.com/jensyt/imurmurhash-js', 'score': 28.924}
{'pkg': 'is-property', 'maintainer_count': 1, 'avg_daily': 308028, 'days_since_commit': 3285, 'open_prs': 1, 'open_issues': 1, 'stars': 13, 'repo_url': 'https://github.com/mikolalysenko/is-property', 'score': 28.6176}
{'pkg': 'process-nextick-args', 'maintainer_count': 1, 'avg_daily': 481813, 'days_since_commit': 2151, 'open_prs': 0, 'open_issues': 2, 'stars': 32, 'repo_url': 'https://github.com/calvinmetcalf/process-nextick-args', 'score': 28.50543333333334}
{'pkg': 'pinkie-promise', 'maintainer_count': 1, 'avg_daily': 433151, 'days_since_commit': 2545, 'open_prs': 1, 'open_issues': 2, 'stars': 117, 'repo_url': 'https://github.com/floatdrop/pinkie-promise', 'score': 28.05336666666667}
{'pkg': 'is-posix-bracket', 'maintainer_count': 1, 'avg_daily': 285728, 'days_since_commit': 3322, 'open_prs': 0, 'open_issues': 0, 'stars': 13, 'repo_url': 'https://github.com/jonschlinkert/is-posix-bracket', 'score': 28.004266666666666}
{'pkg': 'buffer-shims', 'maintainer_count': 1, 'avg_daily': 302514, 'days_since_commit': 3118, 'open_prs': 0, 'open_issues': 2, 'stars': 12, 'repo_url': 'https://github.com/calvinmetcalf/buffer-shims', 'score': 27.5638}
{'pkg': 'xtend', 'maintainer_count': 1, 'avg_daily': 595456, 'days_since_commit': 1734, 'open_prs': 0, 'open_issues': 0, 'stars': 305, 'repo_url': 'https://github.com/Raynos/xtend', 'score': 27.468533333333333}
{'pkg': 'jodid25519', 'maintainer_count': 1, 'avg_daily': 260861, 'days_since_commit': 3390, 'open_prs': 0, 'open_issues': 1, 'stars': 34, 'repo_url': 'https://github.com/meganz/jodid25519', 'score': 27.310366666666663}
{'pkg': 'pinkie', 'maintainer_count': 1, 'avg_daily': 430655, 'days_since_commit': 2454, 'open_prs': 0, 'open_issues': 2, 'stars': 139, 'repo_url': 'https://github.com/floatdrop/pinkie', 'score': 27.245166666666666}
{'pkg': 'preserve', 'maintainer_count': 1, 'avg_daily': 288472, 'days_since_commit': 3149, 'open_prs': 0, 'open_issues': 0, 'stars': 14, 'repo_url': 'https://github.com/jonschlinkert/preserve', 'score': 27.22073333333333}
{'pkg': 'core-util-is', 'maintainer_count': 1, 'avg_daily': 583275, 'days_since_commit': 1348, 'open_prs': 0, 'open_issues': 3, 'stars': 103, 'repo_url': 'https://github.com/isaacs/core-util-is', 'score': 27.167499999999997}
{'pkg': 'once', 'maintainer_count': 1, 'avg_daily': 710970, 'days_since_commit': 578, 'open_prs': 0, 'open_issues': 2, 'stars': 222, 'repo_url': 'https://github.com/isaacs/once', 'score': 26.379000000000005}
{'pkg': 'mimeparse', 'maintainer_count': 1, 'avg_daily': 6467, 'days_since_commit': 4853, 'open_prs': 0, 'open_issues': 0, 'stars': 12, 'repo_url': 'https://github.com/kriskowal/mimeparse', 'score': 26.360566666666667}
{'pkg': 'strip-bom', 'maintainer_count': 1, 'avg_daily': 531743, 'days_since_commit': 1484, 'open_prs': 0, 'open_issues': 0, 'stars': 111, 'repo_url': 'https://github.com/sindresorhus/strip-bom', 'score': 26.03476666666667}
```

