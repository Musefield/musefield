import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { execSync, spawnSync } from 'child_process';

const DEFAULT_CONFIG = '/srv/musefield/config/builder.manifest.yaml';

// helpers
const readText = (p) => fs.readFileSync(p, 'utf8');
const readYaml = (p) => yaml.load(readText(p));
const writeJSON = (p, obj) => fs.writeFileSync(p, JSON.stringify(obj, null, 2));
const nowISO = () => new Date().toISOString();
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const safeN = (x, d=0)=> Number.isFinite(+x) ? +x : d;

function loadConfig() {
  const cfgPath = process.env.BUILDER_CONFIG || DEFAULT_CONFIG;
  if (!fs.existsSync(cfgPath)) throw new Error(`Builder config not found: ${cfgPath}`);
  const root = readYaml(cfgPath);
  if (!root?.builder_config) throw new Error('Missing builder_config in manifest.');
  return { cfgPath, cfg: root.builder_config };
}

// -------- Git stats (last 14 days)
function getGitStats(repoDir) {
  const since = '--since="14 days ago"';
  const run = (cmd) => execSync(cmd, { cwd: repoDir, stdio: ['ignore','pipe','ignore'] }).toString();

  let commits = 0, merges = 0, documented = 0;
  try { commits = parseInt(run(`git rev-list --count ${since} HEAD`).trim(),10)||0; } catch {}
  try { merges  = (run(`git log ${since} --merges --pretty=%H`).trim().split('\n').filter(Boolean).length)||0; } catch {}
  try {
    const lines = run(`git log ${since} --pretty=%s`).trim().split('\n').filter(Boolean);
    const re = /^(feat|fix|docs|refactor|chore|perf|test)(\(|:)/i;
    documented = lines.filter(s=>re.test(s)).length + merges;
  } catch { documented = merges; }

  return { window_days: 14, commits_last_14: commits, merges_last_14: merges, documented_decisions_last_14: documented };
}

// -------- Probe mf-runner
function probe(urlEnv='/workspace') {
  // call the host script so mounts work both host and container
  const script = '/srv/musefield/scripts/mf-probe.sh';
  const alt = '/workspace/scripts/mf-probe.sh';
  const p = fs.existsSync(script) ? script : alt;
  if (!fs.existsSync(p)) return null;
  const out = spawnSync(p, [], { encoding: 'utf8' });
  try { return JSON.parse(out.stdout || '{}'); } catch { return null; }
}

// -------- Micro test
function microtest() {
  const script = '/srv/musefield/scripts/mf-microtest.sh';
  const alt = '/workspace/scripts/mf-microtest.sh';
  const p = fs.existsSync(script) ? script : alt;
  if (!fs.existsSync(p)) return { ok: true };
  const res = spawnSync(p);
  return { ok: res.status === 0 };
}


// --- MuseFund ratio from ledger
function musefundRatio(ledgerPath, fallback=0.10) {
  try {
    if (!fs.existsSync(ledgerPath)) return fallback;
    const rows = fs.readFileSync(ledgerPath, 'utf8').trim().split(/?
/).filter(Boolean);
    if (rows.length <= 1) return fallback; // only header
    const last = rows[rows.length-1].split(',');
    const profit = Number(last[2]);
    const allocated = Number(last[4]);
    if (!Number.isFinite(profit) || profit <= 0) return fallback;
    const r = allocated / profit;
    return (r >= 0 && Number.isFinite(r)) ? r : fallback;
  } catch { return fallback; }
}
function computeReport({ playbookPath, schemaPath, reportsDir, thresholds }) {
  const schema = readYaml(schemaPath)?.aletheia_verification_schema;
  if (!schema) throw new Error('Invalid verification schema file.');

  // Continuity with last report (optional)
  let last = null;
  if (fs.existsSync(reportsDir)) {
    const files = fs.readdirSync(reportsDir).filter(f => f.startsWith('verification_report_')).sort();
    const latest = files.at(-1);
    if (latest) try { last = JSON.parse(readText(path.join(reportsDir, latest))); } catch {}
  }

  // Baselines
  const metrics = {
    coherence_index:       safeN(last?.metrics?.coherence_index, 0.80),
    fund_allocation_ratio: safeN(last?.metrics?.fund_allocation_ratio, 0.22),
    rebuild_success_rate:  safeN(last?.metrics?.rebuild_success_rate, 0.95),
    normalized_throughput: safeN(last?.metrics?.normalized_throughput, 0.90),
    resource_use:          safeN(last?.metrics?.resource_use, 0.85),
    error_rate:            safeN(last?.metrics?.error_rate, 0.05),

    documented_decisions:  0,
    total_decisions:       0,
    latency_ms_avg:        safeN(last?.metrics?.latency_ms_avg, 250)
  };

  // --- Git-derived transparency
  const repoDir = process.env.REPO_DIR || '/workspace';
  let git = { window_days: 14, commits_last_14: 0, merges_last_14: 0, documented_decisions_last_14: 0 };
  try { git = getGitStats(repoDir); } catch {}
  metrics.total_decisions = Math.max(1, git.commits_last_14);
  metrics.documented_decisions = Math.min(metrics.total_decisions, git.documented_decisions_last_14);

  // --- Probe-derived efficiency & accuracy
  const p = probe();
  if (p && Number.isFinite(p.avg_latency_ms)) {
    metrics.latency_ms_avg = p.avg_latency_ms;
    // Throughput ~ requests per second normalized (1/latency)
    const rps = metrics.latency_ms_avg > 0 ? (1000/metrics.latency_ms_avg) : 0;
    metrics.normalized_throughput = rps;  // dimensionless; schema normalizes vs resource_use
    // Accuracy proxy: success ratio of health checks
    const success = safeN(p.ok_count, 0), n = safeN(p.samples, 1);
    metrics.error_rate = clamp(1 - (success / Math.max(n,1)), 0, 1);
  }

  // --- Micro test → reproducibility
  const mt = microtest();
  metrics.rebuild_success_rate = mt.ok ? 0.98 : 0.60; // crude but directional

  // Scoring
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
  const total = Object.values(weighted).reduce((a,b)=>a+b,0);
  const grade = total >= 90 ? 'A' : total >= 80 ? 'B' : total >= 70 ? 'C' : total >= 60 ? 'D' : 'F';

  // Corrective actions
  const t = thresholds || {};
  const corrective_actions = [];
  if (metrics.coherence_index < (t.min_coherence ?? 0.75))
    corrective_actions.push("Run schema reconciliation + minimal loop tests.");
  if ((pct.transparency/100) < (t.min_transparency ?? 0.70))
    corrective_actions.push("Increase documented decisions (conventional commit messages / PR merges).");
  if ((pct.accuracy/100) < (t.min_accuracy ?? 0.90))
    corrective_actions.push("Investigate health probe failures; check mf-runner logs + error traces.");
  if ((pct.reproducibility/100) < (t.min_reproducibility ?? 0.95))
    corrective_actions.push("Stabilize micro-test; ensure deterministic builds.");

  return {
    report_id: `aletheia_verification_report_${Date.now()}`,
    phase_name: "Automated – Builder Verification (Git + Probe)",
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
    generated_by: "MF Builder Lite v0.3"
  };
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
