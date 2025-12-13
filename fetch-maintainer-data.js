/*
Node.js script: github_contributors_maintainers.js

What it does:
1) Reads input CSV with columns: gh_repo_url, pkg_name
2) For each repo: fetches top 3 contributors (by contributions) from GitHub REST API
3) For each package: fetches maintainers from npm registry (tries npm, then PyPI as fallback)
4) For each unique GitHub username (contributors + maintainers if they are GH usernames), fetches profile/contribution stats via getGitHubStats (GraphQL) and re-uses cached results so each username is fetched only once
5) Handles GitHub rate limits by checking response headers and automatically waiting until reset if needed
6) Writes an output CSV with a row per (repo, pkg, username, roles, contributionsCountIfAny, and profile stats)

Usage:
  - Requires Node 18+ (fetch is global). If using older Node, install node-fetch and adapt.
  - Set environment variable GITHUB_TOKEN with a personal access token that has access to read public repos (no special scopes usually required).
  - Run: node github_contributors_maintainers.js input.csv output.csv

Limitations / assumptions:
  - pkg_name is assumed to be an npm package name. The script attempts npm first; if not found it will try PyPI.
  - Input CSV parsing supports quoted fields and commas inside quotes; header row required.
  - This script does not install any external Node packages.
*/

import fs from 'fs/promises';
import path from 'path';

// -------------------- Configuration --------------------
const GITHUB_API_REST = 'https://api.github.com';
const GITHUB_API_GRAPHQL = 'https://api.github.com/graphql';
const NPM_REGISTRY = 'https://registry.npmjs.org';
const PYPI_REGISTRY = 'https://pypi.org/pypi';
const MAX_CONTRIBUTORS = 3; // number of top contributors to get
const GH_RATE_LIMIT_THRESHOLD = 5; // if remaining requests <= this, wait until reset

// -------------------- Helpers --------------------
function parseCsv(text) {
  // Basic CSV parser with support for quoted fields and commas inside quotes.
  const lines = [];
  let cur = '';
  let inQuotes = false;
  let row = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') { // escaped quote
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      row.push(cur);
      cur = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      // handle CRLF
      if (ch === '\r' && text[i + 1] === '\n') continue; // will be handled when \n comes
      row.push(cur);
      lines.push(row);
      row = [];
      cur = '';
    } else {
      cur += ch;
    }
  }
  // push last cell
  if (cur !== '' || row.length > 0) {
    row.push(cur);
    lines.push(row);
  }
  // trim possible empty trailing line
  if (lines.length && lines[lines.length - 1].length === 1 && lines[lines.length - 1][0] === '') {
    lines.pop();
  }
  return lines;
}

function csvToObjects(csvText) {
  const rows = parseCsv(csvText);
  if (!rows || rows.length === 0) return [];
  const header = rows[0].map(h => h.trim());
  const objs = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length === 1 && r[0] === '') continue; // skip empty
    const obj = {};
    for (let j = 0; j < header.length; j++) {
      obj[header[j]] = r[j] !== undefined ? r[j].trim() : '';
    }
    objs.push(obj);
  }
  return objs;
}

function escapeCsvCell(s) {
  if (s === null || s === undefined) return '';
  const str = String(s);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseGitHubRepoUrl(url) {
  // accepts URLs like: https://github.com/owner/repo or git@github.com:owner/repo.git
  try {
    if (url.startsWith('git@')) {
      const parts = url.split(':')[1].replace(/\.git$/, '').split('/');
      return {owner: parts[0], repo: parts[1]};
    }
    const u = new URL(url);
    const parts = u.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/');
    return {owner: parts[0], repo: parts[1]};
  } catch (e) {
    return null;
  }
}

// -------------------- GitHub helpers --------------------
async function checkAndHandleRateLimit(resp) {
  // For both REST and GraphQL, GitHub usually provides X-RateLimit-* headers
  const remaining = resp.headers.get('x-ratelimit-remaining');
  const reset = resp.headers.get('x-ratelimit-reset');
  if (remaining !== null && reset !== null) {
    const rem = parseInt(remaining, 10);
    const resetTs = parseInt(reset, 10) * 1000; // header is seconds
    if (!isNaN(rem) && !isNaN(resetTs)) {
      if (rem <= GH_RATE_LIMIT_THRESHOLD) {
        const wait = Math.max(0, resetTs - Date.now()) + 1000; // add 1s slack
        console.log(`Rate limit low (remaining=${rem}). Sleeping for ${Math.ceil(wait/1000)}s until reset...`);
        await sleep(wait);
        return true; // we waited
      }
    }
  }
  return false; // nothing done
}

async function githubRest(path, token, params = {}) {
  const url = new URL(GITHUB_API_REST + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const resp = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      ...(token ? {'Authorization': `bearer ${token}`} : {})
    }
  });
  await checkAndHandleRateLimit(resp);
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`GitHub REST ${resp.status} ${resp.statusText}: ${txt}`);
  }
  return resp.json();
}

// -------------------- getGitHubStats (GraphQL) --------------------
function findLastContributionDate(weeks) {
  for (let i = weeks.length - 1; i >= 0; i--) {
    const days = weeks[i].contributionDays;
    for (let j = days.length - 1; j >= 0; j--) {
      if (days[j].contributionCount > 0) {
        return days[j].date;
      }
    }
  }
  return null;
}

async function getGitHubStats(username, token) {
  const query = `
    query($username: String!) {
      user(login: $username) {
        updatedAt
        repositories(
          first: 1,
          ownerAffiliations: OWNER,
          orderBy: {field: PUSHED_AT, direction: DESC}
        ) {
          edges { node { pushedAt } }
        }
        contributionsCollection {
          contributionCalendar { totalContributions weeks { contributionDays { contributionCount date } } }
      }
    }
  }
  `;

  const variables = { username };
  const resp = await fetch(GITHUB_API_GRAPHQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? {'Authorization': `bearer ${token}`} : {})
    },
    body: JSON.stringify({ query, variables })
  });

  await checkAndHandleRateLimit(resp);

  const data = await resp.json();
  if (data.errors) {
    console.error('GraphQL errors for', username, data.errors);
    return null;
  }
  if (!data.data || !data.data.user) return null;
  const user = data.data.user;
  const calendar = user.contributionsCollection.contributionCalendar;
  const repoEdges = user.repositories.edges || [];
  const lastPushAt = (repoEdges.length > 0) ? repoEdges[0].node.pushedAt : null;
  const stats = {
    totalContributions: calendar.totalContributions,
    lastActivityAt: user.updatedAt,
    lastPushAt: lastPushAt,
    lastContributionDate: findLastContributionDate(calendar.weeks)
  };
  return stats;
}

// -------------------- Contributors & maintainers --------------------
async function getTopContributors(owner, repo, token, topN = MAX_CONTRIBUTORS) {
  // Uses REST endpoint to list contributors (includes anonymous when available)
  try {
    const contributors = await githubRest(`/repos/${owner}/${repo}/contributors`, token, { per_page: 100 });
    if (!Array.isArray(contributors)) return [];
    // sort by contributions desc and take topN
    const sorted = contributors.sort((a, b) => (b.contributions || 0) - (a.contributions || 0));
    const sliced = sorted.slice(0, topN).map(c => ({ login: c.login, contributions: c.contributions }));
    return sliced;
  } catch (e) {
    console.error(`Failed to get contributors for ${owner}/${repo}:`, e.message);
    return [];
  }
}

async function getNpmMaintainers(pkgName) {
  try {
    const url = `${NPM_REGISTRY}/${encodeURIComponent(pkgName)}`;
    const resp = await fetch(url, { headers: { 'Accept': 'application/vnd.npm.install-v1+json' } });
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`NPM registry returned ${resp.status}`);
    const data = await resp.json();
    if (Array.isArray(data.maintainers)) {
      // maintainers have {name, email}
      return data.maintainers.map(m => ({ name: m.name, email: m.email }));
    }
    return null;
  } catch (e) {
    console.error('NPM fetch error for', pkgName, e.message);
    return null;
  }
}

async function getPypiMaintainers(pkgName) {
  try {
    const url = `${PYPI_REGISTRY}/${encodeURIComponent(pkgName)}/json`;
    const resp = await fetch(url);
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`PyPI registry returned ${resp.status}`);
    const data = await resp.json();
    // PyPI doesn't expose maintainers in the same way; try info.author / info.maintainer
    const info = data.info || {};
    const candidates = [];
    if (info.author) candidates.push({ name: info.author, email: info.author_email || '' });
    if (info.maintainer) candidates.push({ name: info.maintainer, email: info.maintainer_email || '' });
    return candidates.length ? candidates : null;
  } catch (e) {
    console.error('PyPI fetch error for', pkgName, e.message);
    return null;
  }
}

// -------------------- Main flow --------------------
async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('Please set GITHUB_TOKEN environment variable');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node github_contributors_maintainers.js input.csv output.csv');
    process.exit(1);
  }
  const [inputPath, outputPath] = args;

  const inputCsv = await fs.readFile(path.resolve(inputPath), 'utf8');
  const rows = csvToObjects(inputCsv);

  // cache for user stats: username -> stats
  const userCache = new Map();

  // We'll build output rows as objects, then write CSV
  const outputRows = [];

  for (const row of rows) {
    const ghUrl = row['gh_repo_url'] || row['gh_repo'] || row['repo'] || '';
    const pkgName = row['pgk_name'] || row['pkg_name'] || row['package'] || '';
    if (!ghUrl) {
      console.warn('Skipping row with no gh_repo_url', row);
      continue;
    }
    const parsed = parseGitHubRepoUrl(ghUrl);
    if (!parsed) {
      console.warn('Could not parse repo url:', ghUrl);
      continue;
    }
    const { owner, repo } = parsed;
    console.log(`Processing ${owner}/${repo}  (pkg: ${pkgName})`);

    // contributors
    const contributors = await getTopContributors(owner, repo, token, MAX_CONTRIBUTORS);

    // maintainers: try npm, then PyPI
    let maintainers = null;
    if (pkgName) {
      maintainers = await getNpmMaintainers(pkgName);
      if (!maintainers) {
        maintainers = await getPypiMaintainers(pkgName);
      }
    }

    // convert maintainers into a list of candidate GitHub usernames if possible
    // NPM maintainer 'name' is often a npm username which may be the same as GitHub login but not guaranteed.
    // We'll treat maintainer.name as a candidate GitHub login and attempt to fetch stats for it; if it doesn't exist we'll ignore.

    const roleMap = new Map(); // username -> { roles: Set, contributions }

    for (const c of contributors) {
      if (!c.login) continue;
      const item = roleMap.get(c.login) || { roles: new Set(), contributions: 0 };
      item.roles.add('contributor');
      item.contributions = c.contributions || 0;
      roleMap.set(c.login, item);
    }

    if (maintainers && maintainers.length) {
      for (const m of maintainers) {
        const candidate = m.name;
        if (!candidate) continue;
        const item = roleMap.get(candidate) || { roles: new Set(), contributions: 0 };
        item.roles.add('maintainer');
        roleMap.set(candidate, item);
      }
    }

    // For each username in roleMap, fetch stats (cached)
    for (const [username, info] of roleMap.entries()) {
      if (!userCache.has(username)) {
        // try fetch stats -- if 404 or no user, store null to avoid retry
        try {
          const stats = await getGitHubStats(username, token);
          if (!stats) {
            userCache.set(username, null);
          } else {
            userCache.set(username, stats);
          }
        } catch (e) {
          console.error('Error fetching stats for', username, e.message);
          userCache.set(username, null);
        }
      }
      const stats = userCache.get(username);

      outputRows.push({
        repo_full: `${owner}/${repo}`,
        repo_url: ghUrl,
        pkg_name: pkgName,
        username: username,
        roles: Array.from(info.roles).join('|'),
        contributions_count: info.contributions || '',
        totalContributions: stats ? stats.totalContributions : '',
        lastActivityAt: stats ? stats.lastActivityAt : '',
        lastPushAt: stats ? stats.lastPushAt : '',
        lastContributionDate: stats ? stats.lastContributionDate : ''
      });
    }

    // Small pause between repositories to be polite (and reduce bursts)
    await sleep(500);
  }

  // write CSV
  const header = ['repo_full','repo_url','pkg_name','username','roles','contributions_count','totalContributions','lastActivityAt','lastPushAt','lastContributionDate'];
  const csvLines = [header.map(escapeCsvCell).join(',')];
  for (const r of outputRows) {
    const line = header.map(h => escapeCsvCell(r[h] || '')).join(',');
    csvLines.push(line);
  }
  await fs.writeFile(path.resolve(outputPath), csvLines.join('\n'), 'utf8');
  console.log(`Wrote ${outputRows.length} rows to ${outputPath}`);
}

// Run
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
