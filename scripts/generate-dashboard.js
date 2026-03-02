#!/usr/bin/env node
// generate-dashboard.js — fetches live org data, writes dashboard to profile/README.md

const { execSync } = require('child_process')
const fs = require('fs')

const ORG = 'agentiagency'
const REPOS = [
  'agentimolt-v03', 'agentisync', 'agentisecure', 'agenticlaw',
  'agentiprotect', 'protectgateway', 'synergi', 'agentiv',
]

function gh(cmd) {
  try {
    return JSON.parse(execSync(`gh api "${cmd}" --paginate 2>/dev/null`, { encoding: 'utf8' }))
  } catch { return null }
}

function ciStatus(checks) {
  if (!checks || !checks.check_runs) return { passing: 0, total: 0, symbol: '⚪' }
  const runs = checks.check_runs.filter(r => r.status === 'completed')
  const total = runs.length
  const passing = runs.filter(r => r.conclusion === 'success').length
  const symbol = total === 0 ? '⚪' : passing === total ? '🟢' : passing === 0 ? '🔴' : '🟡'
  return { passing, total, symbol }
}

function latestCIForBranch(repo, branch) {
  const commits = gh(`repos/${ORG}/${repo}/commits?sha=${branch}&per_page=1`)
  if (!commits || !commits[0]) return null
  const checks = gh(`repos/${ORG}/${repo}/commits/${commits[0].sha}/check-runs`)
  return ciStatus(checks)
}

function latestCIForLatestPR(repo) {
  const prs = gh(`repos/${ORG}/${repo}/pulls?state=open&per_page=1&sort=updated&direction=desc`)
  if (!prs || !prs[0]) return { passing: 0, total: 0, symbol: '⚪', prNumber: null }
  const pr = prs[0]
  const checks = gh(`repos/${ORG}/${repo}/commits/${pr.head.sha}/check-runs`)
  return { ...ciStatus(checks), prNumber: pr.number }
}

function getWeeklyActivity(repo) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const items = gh(`repos/${ORG}/${repo}/issues?state=all&since=${since}&per_page=100`) || []
  const prs = items.filter(i => i.pull_request)
  const issues = items.filter(i => !i.pull_request)

  return [3, 2, 1, 0].map(w => {
    const start = new Date(Date.now() - (w + 1) * 7 * 24 * 60 * 60 * 1000)
    const end   = new Date(Date.now() - w * 7 * 24 * 60 * 60 * 1000)
    const inWindow = (d) => { const t = new Date(d); return t >= start && t < end }
    return {
      label: `W${4 - w}`,
      created: issues.filter(i => inWindow(i.created_at)).length,
      closed:  issues.filter(i => i.closed_at && inWindow(i.closed_at)).length,
      merged:  prs.filter(i => i.pull_request?.merged_at && inWindow(i.pull_request.merged_at)).length,
    }
  })
}

function mermaidChart(repo, weeks) {
  const labels  = weeks.map(w => `"${w.label}"`).join(', ')
  const created = weeks.map(w => w.created).join(', ')
  const closed  = weeks.map(w => w.closed).join(', ')
  const merged  = weeks.map(w => w.merged).join(', ')
  return ['```mermaid',
    'xychart-beta',
    `  title "${repo} — last 30d (created / closed / merged)"`,
    `  x-axis [${labels}]`,
    '  y-axis "count" 0 --> 20',
    `  bar [${created}]`,
    `  bar [${closed}]`,
    `  bar [${merged}]`,
    '```'].join('\n')
}

function main() {
  const now = new Date().toUTCString()
  const rows = [], charts = []

  for (const repo of REPOS) {
    process.stderr.write(`  → ${repo}\n`)
    const repoData = gh(`repos/${ORG}/${repo}`)
    if (!repoData) continue

    const allPRs  = gh(`repos/${ORG}/${repo}/pulls?state=open&per_page=100`) || []
    const prCount = allPRs.length
    const issueCount = Math.max(0, (repoData.open_issues_count || 0) - prCount)

    const mainCI = latestCIForBranch(repo, repoData.default_branch || 'main')
    const prCI   = latestCIForLatestPR(repo)

    const mainStr = mainCI
      ? `${mainCI.symbol} \`${mainCI.passing}/${mainCI.total}\``
      : '⚪ `—`'
    const prStr = prCI.prNumber
      ? `${prCI.symbol} \`${prCI.passing}/${prCI.total}\` [#${prCI.prNumber}](https://github.com/${ORG}/${repo}/pull/${prCI.prNumber})`
      : '⚪ `—`'

    rows.push(`| [**${repo}**](https://github.com/${ORG}/${repo}) | ${issueCount} | ${prCount} | ${mainStr} | ${prStr} |`)

    const weeks = getWeeklyActivity(repo)
    charts.push(`<details><summary><strong>${repo}</strong></summary>\n\n${mermaidChart(repo, weeks)}\n\n</details>`)
  }

  const dashboard = `## 📊 repository dashboard

> _last updated: ${now}_

| repo | 🐛 issues | 🔀 prs | main CI | latest PR CI |
|------|-----------|--------|---------|--------------|
${rows.join('\n')}

---

## 📈 activity — last 30 days

> bars: **issues created** · **issues closed** · **PRs merged** (by week)

${charts.join('\n\n')}
`

  const readmePath = 'profile/README.md'
  let readme = fs.readFileSync(readmePath, 'utf8')
  const START = '<!-- DASHBOARD:START -->'
  const END   = '<!-- DASHBOARD:END -->'

  if (readme.includes(START)) {
    const re = new RegExp(`${START}[\\s\\S]*?${END}`, 'm')
    readme = readme.replace(re, `${START}\n${dashboard}\n${END}`)
  } else {
    readme += `\n${START}\n${dashboard}\n${END}\n`
  }

  fs.writeFileSync(readmePath, readme)
  process.stderr.write('Done.\n')
}

main()
