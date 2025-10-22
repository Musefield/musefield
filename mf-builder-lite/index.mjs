import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { execSync } from 'child_process';

const DEFAULT_CONFIG = '/srv/musefield/config/builder.manifest.yaml';

// --- helpers
const readText = (p) => fs.readFileSync(p, 'utf8');
const readYaml = (p) => yaml.load(readText(p));
const writeJSON = (p, obj) => fs.writeFileSync(p, JSON.stringify(obj, null, 2));
const nowISO = () => new Date().toISOString();
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function loadConfig() {
  const cfgPath = process.env.BUILDER_CONFIG || DEFAULT_CONFIG;
  if (!fs.existsSync(cfgPath)) throw new Error(`Builder config not found: ${cfgPath}`);
  const root = readYaml(cfgPath);
  if (!root?.builder_config) throw new Error('Missing builder_config in manifest.');
  return { cfgPath, cfg: root.builder_config };
}

function safeNumber(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

// ---- Git metrics (last 14 days)
function getGitStats(repoDir) {
  const sinceDays = 14;
  const sinceArg = `--since="${sinceDays} days ago"`;

  const run = (cmd) =>
    execSync(cmd, { cwd: repoDir, stdio: ['ignore', 'pipe', 'ignore'] }).toString();

  // Count commits
  let commits = 0;
  try {
    const out = run(`git rev-list --count ${sinceArg} HEAD`);
    commits = parseInt(out.trim(), 10) || 0;
  } catch { commits = 0; }

  // Count merges
  let merges = 0;
  try {
    const out = run(`git log ${sinceArg} --merges --pretty=%H`);
    merges = out.trim() ? out.trim().split('\n').length : 0;
  } catch { merges = 0; }

  // Count "documented" commits (conventional prefixes or merges)
  let documented = 0;
  try {
    const out = run(`git log ${sinceArg} --pretty=%s`);
    const lines = out.trim() ? out.trim().split('\n') : [];
    const re = /^(feat|fix|docs|refactor|chore|perf|test)(\(|:)/i;
    documented = lines.filter(s => re.test(s)).length + merges;
  } catch { documented = merges; }

  return {
    window_days: sinceDays,
    commits_last_14: commits,
    merges_last_14: merges,
    documented_decisions_last_14: documented,
  };
}

// ---- Compute report
function computeReport({ playbookPath, schemaPath, reportsDir, thresholds }) {
  const schema = readYaml(schemaPath)?.aletheia_verification_schema;
  if (!schema) throw new Error('Invalid verification schema file.');

  // Load last report (optional continuity)
  let last = null;
  if (fs.existsSync(reportsDir)) {
    const files = fs.readdirSync(reportsDir).filter(f => f.startsWith('verification_report_') && f.endsWith('.json'));
    files.sort();
    const latest = files.at(-1);
    if (latest) {
      try { last = JSON.parse(readText(path.join(reportsDir, latest))); } catch { /* noop */ }
    }
  }

  // Baseline metrics (replace with your real signals as they come online)
  const metrics = {
    coherence_index:          safeNumber(last?.metrics?.coherence_index ?? 0.80),
    error_rate:               safeNumber(last?.metrics?.error_rate ?? 0.05),
    normalized_throughput:    safeNumber(last?.metrics?.normalized_throughput ?? 0.90),
    resource_use:             safeNumber(last?.metrics?.resource_use ?? 0.85),
    fund_allocation_ratio:    safeNumber(last?.metrics?.fund_allocation_ratio ?? 0.22),
    rebuild_success_rate:     safeNumber(last?.metrics?.rebuild_success_rate ?? 0.95),

    // Will be replaced by git-derived values below
    documented_decisions:     0,
    total_decisions:          0,
  };

  // --- Git-derived transparency
  const repoDir = process.env.REPO_DIR || '/workspace';
  let git = { window_days: 14, commits_last_14: 0, merges_last_14: 0, documented_decisions_last_14: 0 };
  try { git = getGitStats(repoDir); } catch { /* keep zeros */ }

  // Define "decisions" as commits (you can swap to PRs later)
  metrics.total_decisions = Math.max(1, git.commits_last_14);
  metrics.documented_decisions = Math.min(metrics.total_decisions, git.documented_decisions_last_14);

  // Scoring per schema
  const w = schema.weights;
  const pct = {
    coherence:        clamp(metrics.coherence_index * 100, 0, 100),
    accuracy:         clamp((1 - metrics.error_rate) * 100, 0, 100),
    efficiency:       clamp((metrics.normalized_throughput / Math.max(metrics.resource_use, 0.0001)) * 100, 0, 100),
    transparency:     clamp((metrics.documented_decisions / Math.max(metrics.total_decisions, 1)) * 100, 0, 100),
    regeneration:     clamp(metrics.fund_allocation_ratio * 100, 0, 100),
    reproducibility:  clamp(metrics.rebuild_success_rate * 100, 0, 100),
  };

  const weighted = {
    coherence:        +(pct.coherence * w.coherence).toFixed(1),
    accuracy:         +(pct.accuracy * w.accuracy).toFixed(1),
    efficiency:       +(pct.efficiency * w.efficiency).toFixed(1),
    transparency:     +(pct.transparency * w.transparency).toFixed(1),
    regeneration:     +(pct.regeneration * w.regeneration).toFixed(1),
    reproducibility:  +(pct.reproducibility * w.reproducibility).toFixed(1),
  };

  const total = Object.values(weighted).reduce((a, b) => a + b, 0);
  const grade = total >= 90 ? 'A' : total >= 80 ? 'B' : total >= 70 ? 'C' : total >= 60 ? 'D' : 'F';

  // Corrective actions vs thresholds
  const t = thresholds || {};
  const corrective_actions = [];
  if (metrics.coherence_index < (t.min_coherence ?? 0.75)) {
    corrective_actions.push("Increase coherence: run schema reconciliation + minimal loop tests.");
  }
  if ((pct.transparency/100) < (t.min_transparency ?? 0.75)) {
    corrective_actions.push("Raise transparency: improve commit hygiene (conventional messages), link PRs.");
  }
  if ((t.min_automation_ratio ?? 0.70) > (last?.metrics?.automation_ratio ?? 0.70)) {
    // Placeholder: when you start logging automation_ratio, enforce here.
  }

  const report = {
    report_id: `aletheia_verification_report_${Date.now()}`,
    phase_name: "Automated – Builder Verification (Git-aware)",
    date_range: { start: nowISO(), end: nowISO() },
    metrics: {
      ...metrics,
      git_window_days: git.window_days,
      commits_last_14: git.commits_last_14,
      merges_last_14: git.merges_last_14
    },
    weighted_scores: weighted,
    total_score: +total.toFixed(1),
    grade,
    anomalies_detected: [],
    corrective_actions,
    human_review: { reviewer: "", comments: "" },
    generated_by: "MF Builder Lite v0.2",
  };
  return report;
}

function main() {
  const { cfg } = loadConfig();
  const playbookPath = cfg.playbook_path;
  const schemaPath   = cfg.verification_schema_path;
  const reportsDir   = cfg.reports_dir;

  if (!fs.existsSync(playbookPath)) throw new Error(`Playbook not found: ${playbookPath}`);
  if (!fs.existsSync(schemaPath)) throw new Error(`Verification schema not found: ${schemaPath}`);
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const rpt = computeReport({ playbookPath, schemaPath, reportsDir, thresholds: cfg.thresholds });
  const ts = new Date().toISOString().replace(/[:-]/g,'').replace(/\..+/,'') + "Z";
  const out = path.join(reportsDir, `verification_report_${ts}.json`);
  writeJSON(out, rpt);
  console.log(`Wrote ${out}\nScore: ${rpt.total_score}  Grade: ${rpt.grade}`);
}

try { main(); } catch (err) {
  console.error('[builder-lite] ERROR:', err.message);
  process.exit(1);
}
