import fs from 'fs/promises';
import path from 'path';

const GITHUB_API_REST = 'https://api.github.com';
const GITHUB_API_GRAPHQL = 'https://api.github.com/graphql';
const NPM_REGISTRY = 'https://registry.npmjs.org';
const PYPI_REGISTRY = 'https://pypi.org/pypi';
const MAX_CONTRIBUTORS = 3;
const GH_RATE_LIMIT_THRESHOLD = 5;

function parseCsv(text) {
  const lines = [];
  let cur = '';
  let inQuotes = false;
  let row = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      row.push(cur);
      cur = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') continue;
      row.push(cur);
      lines.push(row);
      row = [];
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur !== '' || row.length > 0) {
    row.push(cur);
    lines.push(row);
  }
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
    if (r.length === 1 && r[0] === '') continue;
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

async function checkAndHandleRateLimit(resp) {
  const remaining = resp.headers.get('x-ratelimit-remaining');
  const reset = resp.headers.get('x-ratelimit-reset');
  if (remaining !== null && reset !== null) {
    const rem = parseInt(remaining, 10);
    const resetTs = parseInt(reset, 10) * 1000;
    if (!isNaN(rem) && !isNaN(resetTs)) {
      if (rem <= GH_RATE_LIMIT_THRESHOLD) {
        const wait = Math.max(0, resetTs - Date.now()) + 1000;
        console.log(`Rate limit low (remaining=${rem}). Sleeping for ${Math.ceil(wait/1000)}s until reset...`);
        await sleep(wait);
        return true;
      }
    }
  }
  return false;
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

async function getTopContributors(owner, repo, token, topN = MAX_CONTRIBUTORS) {
  try {
    const contributors = await githubRest(`/repos/${owner}/${repo}/contributors`, token, { per_page: 100 });
    if (!Array.isArray(contributors)) return [];
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

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('Please set GITHUB_TOKEN environment variable');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node fetch-maintainer-data.js input.csv output.csv');
    process.exit(1);
  }
  const [inputPath, outputPath] = args;

  const inputCsv = await fs.readFile(path.resolve(inputPath), 'utf8');
  const rows = csvToObjects(inputCsv);

  const userCache = new Map();

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

    const contributors = await getTopContributors(owner, repo, token, MAX_CONTRIBUTORS);

    let maintainers = null;
    if (pkgName) {
      maintainers = await getNpmMaintainers(pkgName);
      if (!maintainers) {
        maintainers = await getPypiMaintainers(pkgName);
      }
    }

    const roleMap = new Map();

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

    for (const [username, info] of roleMap.entries()) {
      if (!userCache.has(username)) {
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

    await sleep(500);
  }

  const header = ['repo_full','repo_url','pkg_name','username','roles','contributions_count','totalContributions','lastActivityAt','lastPushAt','lastContributionDate'];
  const csvLines = [header.map(escapeCsvCell).join(',')];
  for (const r of outputRows) {
    const line = header.map(h => escapeCsvCell(r[h] || '')).join(',');
    csvLines.push(line);
  }
  await fs.writeFile(path.resolve(outputPath), csvLines.join('\n'), 'utf8');
  console.log(`Wrote ${outputRows.length} rows to ${outputPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
