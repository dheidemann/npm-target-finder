#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

if (process.argv.length < 4) {
  console.error('Usage: node github-avg-open-times.js input.csv output.csv [--token=PAT]');
  process.exit(2);
}

const inputCsv = process.argv[2];
const outputCsv = process.argv[3];

let tokenArg = process.argv.find(a => a.startsWith('--token='));
const GITHUB_PAT = tokenArg ? tokenArg.split('=')[1] : process.env.GITHUB_PAT;
if (!GITHUB_PAT) {
  console.error('Error: Provide GitHub PAT via --token=PAT or GITHUB_PAT environment variable.');
  process.exit(2);
}

const PER_PAGE = 100;
const MIN_REMAINING = 5;

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function githubFetch(url, opts = {}, retry = 0) {
  const headers = Object.assign({}, opts.headers || {}, {
    'accept': 'application/vnd.github.v3+json',
    'user-agent': 'gh-avg-open-times-script',
    'authorization': `token ${GITHUB_PAT}`
  });
  const finalOpts = Object.assign({}, opts, { headers });

  try {
    const res = await fetch(url, finalOpts);
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');

    if (remaining !== null && reset !== null) {
      const rem = parseInt(remaining, 10);
      const resetTs = parseInt(reset, 10) * 1000;
      if (rem <= MIN_REMAINING) {
        const waitMs = Math.max(1000, resetTs - Date.now() + 1000);
        console.warn(`Rate limit low (remaining=${rem}). Waiting ${Math.round(waitMs/1000)}s until reset...`);
        await sleep(waitMs);
        return githubFetch(url, opts);
      }
    }

    if (res.status === 202) {
      if (retry < 5) {
        await sleep(2000 * (retry + 1));
        return githubFetch(url, opts, retry + 1);
      }
    }
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
      const reset = res.headers.get('x-ratelimit-reset');
      const resetMs = parseInt(reset, 10) * 1000;
      const waitMs = Math.max(1000, resetMs - Date.now() + 1000);
      console.warn(`Hit rate limit. Waiting ${Math.round(waitMs/1000)}s until reset...`);
      await sleep(waitMs);
      return githubFetch(url, opts);
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`GitHub API ${res.status} ${res.statusText} - ${txt}`);
    }

    const json = await res.json();
    return { json, headers: res.headers };
  } catch (err) {
    if (retry < 3) {
      console.warn(`Fetch error for ${url}: ${err.message}. Retrying...`);
      await sleep(1000 * (retry + 1));
      return githubFetch(url, opts, retry + 1);
    }
    throw err;
  }
}

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = parseCsvLine(line);
    const obj = {};
    headers.forEach((h, i) => obj[h.trim()] = vals[i] === undefined ? '' : vals[i]);
    return obj;
  });
}

function parseCsvLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i+1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

function formatCsvRow(arr) {
  return arr.map(val => {
    if (val === null || val === undefined) return '';
    const s = String(val);
    if (s.includes(',') || s.includes('\"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }).join(',');
}

function repoFromUrl(url) {
  url = url.trim();
  if (!url) return null;
  try {
    if (url.startsWith('git@')) {
      const parts = url.split(':');
      const path = parts[1].replace(/\.git$/, '');
      const [owner, repo] = path.split('/');
      return { owner, repo };
    } else {
      const u = new URL(url);
      const parts = u.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/');
      if (parts.length >= 2) return { owner: parts[0], repo: parts[1] };
    }
  } catch (e) {
    return null;
  }
  return null;
}

function hoursBetween(isoA, isoB) {
  const a = new Date(isoA).getTime();
  const b = new Date(isoB).getTime();
  return (b - a) / (1000 * 60 * 60);
}

function filterOutliers(values) {
  if (!values || values.length === 0) return values;
  const sorted = [...values].sort((a,b) => a-b);
  const q1 = sorted[Math.floor((sorted.length / 4))];
  const q3 = sorted[Math.floor((3 * sorted.length / 4))];
  const iqr = q3 - q1;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  return values.filter(v => v >= lower && v <= upper);
}

async function fetchAllPagesJson(baseUrl, params = {}) {
  let page = 1;
  const accum = [];
  while (true) {
    const url = new URL(baseUrl);
    Object.entries(Object.assign({}, params, { per_page: PER_PAGE, page })).forEach(([k,v]) => url.searchParams.set(k, v));
    const { json } = await githubFetch(url.toString());
    if (!Array.isArray(json)) throw new Error('Expected array from GitHub API');
    accum.push(...json);
    if (json.length < PER_PAGE) break;
    page++;
    await sleep(200);
  }
  return accum;
}

async function calcForRepo(owner, repo) {
  const base = `https://api.github.com/repos/${owner}/${repo}`;
  const nowIso = new Date().toISOString();

  const closedIssues = await fetchAllPagesJson(`${base}/issues`, { state: 'closed' });
  const openIssues = await fetchAllPagesJson(`${base}/issues`, { state: 'open' });

  let closedIssueDurations = closedIssues.filter(i => !i.pull_request && i.closed_at).map(i => hoursBetween(i.created_at, i.closed_at));
  let openIssueDurations = openIssues.filter(i => !i.pull_request).map(i => hoursBetween(i.created_at, nowIso));

  closedIssueDurations = filterOutliers(closedIssueDurations);
  openIssueDurations = filterOutliers(openIssueDurations);

  const closedPRs = await fetchAllPagesJson(`${base}/pulls`, { state: 'closed' });
  const openPRs = await fetchAllPagesJson(`${base}/pulls`, { state: 'open' });

  let closedPrDurations = closedPRs.filter(p => p.closed_at).map(p => hoursBetween(p.created_at, p.closed_at));
  let openPrDurations = openPRs.map(p => hoursBetween(p.created_at, nowIso));

  closedPrDurations = filterOutliers(closedPrDurations);
  openPrDurations = filterOutliers(openPrDurations);

  function avg(arr) {
    if (!arr || arr.length === 0) return null;
    return arr.reduce((a,b) => a + b, 0) / arr.length;
  }

  return {
    avg_issue_till_closed: avg(closedIssueDurations),
    avg_pr_till_closed: avg(closedPrDurations),
    avg_issue_open_time: avg(openIssueDurations),
    avg_pr_open_time: avg(openPrDurations),
  };
}

(async function main() {
  try {
    const raw = fs.readFileSync(inputCsv, 'utf8');
    const rows = parseCsv(raw);
    if (rows.length === 0) {
      console.error('No rows in input CSV');
      process.exit(2);
    }

    if (!('gh_repo_url' in rows[0]) || !('pkg_name' in rows[0])) {
      console.error('Input CSV must have headers including pkg_name and gh_repo_url');
      process.exit(2);
    }

    const outRows = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const pkg = r['pkg_name'];
      const gh = r['gh_repo_url'];
      process.stdout.write(`Processing ${i+1}/${rows.length}: ${pkg} -> ${gh}... `);
      const repo = repoFromUrl(gh);
      if (!repo) {
        console.log('invalid repo URL');
        outRows.push({ pkg_name: pkg, avg_issue_till_closed: '', avg_pr_till_closed: '', avg_issue_open_time: '', avg_pr_open_time: '' });
        continue;
      }

      try {
        const res = await calcForRepo(repo.owner, repo.repo);
        const formatNum = (n) => n === null ? '' : (Math.round(n * 100) / 100).toFixed(2);
        outRows.push({
          pkg_name: pkg,
          avg_issue_till_closed: formatNum(res.avg_issue_till_closed),
          avg_pr_till_closed: formatNum(res.avg_pr_till_closed),
          avg_issue_open_time: formatNum(res.avg_issue_open_time),
          avg_pr_open_time: formatNum(res.avg_pr_open_time),
        });
        console.log('done');
      } catch (err) {
        console.error(`error: ${err.message}`);
        outRows.push({ pkg_name: pkg, avg_issue_till_closed: '', avg_pr_till_closed: '', avg_issue_open_time: '', avg_pr_open_time: '' });
      }
    }

    const header = ['pkg_name','avg_issue_till_closed','avg_pr_till_closed','avg_issue_open_time','avg_pr_open_time'];
    const lines = [formatCsvRow(header)];
    for (const r of outRows) lines.push(formatCsvRow(header.map(h => r[h])));
    fs.writeFileSync(outputCsv, lines.join('\n'), 'utf8');
    console.log(`Wrote results to ${outputCsv}`);
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
})();
