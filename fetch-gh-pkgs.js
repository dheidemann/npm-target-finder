#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const counts = require("download-counts");
const getRepoUrl = require("get-repository-url");
const pacote = require("pacote");
const axios = require("axios");

const argv = process.argv.slice(2);
function hasFlag(name) {
  return argv.includes(name);
}
function getFlagValue(name, defaultValue) {
  const idx = argv.indexOf(name);
  if (idx === -1 || idx === argv.length - 1) return defaultValue;
  return argv[idx + 1];
}

const INCLUDE_GITHUB = hasFlag("--include-github");
const OUTPUT_FILE = getFlagValue(
  "--output",
  path.join(__dirname, "packages.csv")
);
const DAILY_THRESHOLD = Number(getFlagValue("--threshold", "1000"));
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";

// sleep until given timestamp
function sleepUntil(resetTimestamp) {
  const delay = resetTimestamp * 1000 - Date.now();
  return delay > 0
    ? new Promise((r) => setTimeout(r, delay))
    : Promise.resolve();
}

// axios wrapper to handle github rate limits
async function ghGet(url, config = {}) {
  const authHeader = GITHUB_TOKEN.startsWith("github_pat_")
    ? { Authorization: `Bearer ${GITHUB_TOKEN}` }
    : { Authorization: `token ${GITHUB_TOKEN}` };
  let resp;
  while (true) {
    resp = await axios.get(url, { ...config, headers: authHeader });
    const remaining = parseInt(
      resp.headers["x-ratelimit-remaining"] || "0",
      10
    );
    const reset = parseInt(resp.headers["x-ratelimit-reset"] || "0", 10);
    if (remaining === 0) {
      console.warn(
        `Rate limit reached. Waiting until ${new Date(
          reset * 1000
        ).toISOString()}`
      );
      await sleepUntil(reset);
      continue;
    }
    return resp;
  }
}

async function getMaintainerCount(packageName) {
  const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(
    packageName
  )}`;
  try {
    const response = await axios.get(registryUrl);
    const maintainers = response.data.maintainers;
    return Array.isArray(maintainers) ? maintainers.length : 0;
  } catch {
    return 0;
  }
}

async function fetchGitHubRepoData(repoPath) {
  const apiBase = `https://api.github.com/repos/${repoPath}`;

  const repoResp = await ghGet(apiBase);
  const repo = repoResp.data;
  const stars = repo.stargazers_count;
  const daysSinceCommit = Math.floor(
    (Date.now() - new Date(repo.pushed_at).getTime()) / (1000 * 60 * 60 * 24)
  );

  const prResp = await ghGet(`${apiBase}/pulls?state=open&per_page=100`);
  const openPRs = prResp.data.length;

  const issuesResp = await ghGet(`${apiBase}/issues?state=open&per_page=100`);
  const openIssues = issuesResp.data.length - openPRs;

  return { daysSinceCommit, openPRs, openIssues, stars };
}

async function listUpstreamDependencies(packageName) {
  try {
    const manifest = await pacote.manifest(packageName);
    return manifest.dependencies ? Object.keys(manifest.dependencies) : [];
  } catch {
    return [];
  }
}

async function main() {
  console.log("Options:", {
    INCLUDE_GITHUB,
    OUTPUT_FILE,
    DAILY_THRESHOLD,
  });

  const out = fs.createWriteStream(OUTPUT_FILE, { encoding: "utf8" });
  let base = ["pkg_name"];
  if (INCLUDE_GITHUB) {
    base.push(
      "days_since_commit",
      "open_prs",
      "open_issues",
      "stars",
      "repo_url"
    );
  }
  base.push("dependencies_json");

  out.write(base.join(",") + "\n");

  let totalWritten = 0;

  for (const [pkg, avgDaily] of Object.entries(counts)) {
    if (avgDaily < DAILY_THRESHOLD) continue;

    const maintainerCount = await getMaintainerCount(pkg);

    let ghStats;
    if (INCLUDE_GITHUB) {
      let repoUrl;
      try {
        repoUrl = await getRepoUrl(pkg);
      } catch {
        continue;
      }
      if (!repoUrl || !repoUrl.includes("github.com")) continue;
      const match = repoUrl.match(/github\.com\/([^\/]+\/[^"]+)(?:\.git)?$/);
      if (!match) continue;
      const repoPath = match[1];

      try {
        ghStats = await fetchGitHubRepoData(repoPath);
      } catch {
        continue;
      }
    }

    let row = [pkg];

    if (INCLUDE_GITHUB) {
      row.push(
        ghStats.daysSinceCommit,
        ghStats.openPRs,
        ghStats.openIssues,
        ghStats.stars,
        repoUrl
      );
    }

    const deps = await listUpstreamDependencies(pkg);
    row.push(JSON.stringify(deps));

    out.write(row.join(",") + "\n");
    totalWritten++;
  }

  out.end(() =>
    console.log(`Wrote ${totalWritten} packages to ${OUTPUT_FILE}`)
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
