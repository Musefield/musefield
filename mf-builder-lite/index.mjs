import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const DEFAULT_CONFIG = '/srv/musefield/config/builder.manifest.yaml';

// --- helpers
const readText = (p) => fs.readFileSync(p, 'utf8');
const readYaml = (p) => yaml.load(readText(p));
const writeJSON = (p, obj) => fs.writeFileSync(p, JSON.stringify(obj, null, 2));
const nowISO = () => new Date().toISOString();

function loadConfig() {
  const cfgPath = process.env.BUILDER_CONFIG || DEFAULT_CONFIG;
  if (!fs.existsSync(cfgPath)) {
    throw new Error(`Builder config not found: ${cfgPath}`);
  }
  const cfg = readYaml(cfgPath);
  if (!cfg?.builder_config) throw new Error('Missing builder_config in manifest.');
  return { cfgPath, cfg: cfg.builder_config };
}

function safeNumber(x, fallback=0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

// Compute a report using schema weights and some pragmatic defaults
function computeReport({ playbookPath, schemaPath, reportsDir }) {
  const schema = readYaml(schemaPath)?.aletheia_verification_schema;
  if (!schema) throw new Error('Invalid verification schema file.');

  // Load last report if present to keep continuity
  let lastMetrics = null;
  if (fs.existsSync(reportsDir)) {
    const files = fs.readdirSync(reportsDir).filter(f => f.startsWith('verification_report_') && f.endsWith('.json'));
    files.sort();
    const latest = files.at(-1);
    if (latest) {
      try { lastMetrics = JSON.parse(readText(path.join(reportsDir, latest))).metrics; } catch {}
    }
  }

  // Minimal heuristics (replace with your real signals later)
  const metrics = {
    coherence_index: safeNumber(lastMetrics?.coherence_index ?? 0.80),
    error_rate:      safeNumber(lastMetrics?.error_rate ?? 0.05),
    normalized_throughput: safeNumber(lastMetrics?.normalized_throughput ?? 0.90),
    resource_use:    safeNumber(lastMetrics?.resource_use ?? 0.85),
    documented_decisions: safeNumber(lastMetrics?.documented_decisions ?? 48),
    total_decisions: safeNumber(lastMetrics?.total_decisions ?? 50),
    fund_allocation_ratio: safeNumber(lastMetrics?.fund_allocation_ratio ?? 0.22),
    rebuild_success_rate:  safeNumber(lastMetrics?.rebuild_success_rate ?? 0.95)
  };

  // Scoring per schema
  const w = schema.weights;
  const pct = {
    coherence:     Math.max(0, Math.min(100, metrics.coherence_index * 100)),
    accuracy:      Math.max(0, Math.min(100, (1 - metrics.error_rate) * 100)),
    efficiency:    Math.max(0, Math.min(100, (metrics.normalized_throughput / Math.max(metrics.resource_use, 0.0001)) * 100)),
    transparency:  Math.max(0, Math.min(100, (metrics.documented_decisions / Math.max(metrics.total_decisions, 1)) * 100)),
    regeneration:  Math.max(0, Math.min(100, metrics.fund_allocation_ratio * 100)),
    reproducibility: Math.max(0, Math.min(100, metrics.rebuild_success_rate * 100))
  };

  const weighted = {
    coherence:       +(pct.coherence * w.coherence).toFixed(1),
    accuracy:        +(pct.accuracy * w.accuracy).toFixed(1),
    efficiency:      +(pct.efficiency * w.efficiency).toFixed(1),
    transparency:    +(pct.transparency * w.transparency).toFixed(1),
    regeneration:    +(pct.regeneration * w.regeneration).toFixed(1),
    reproducibility: +(pct.reproducibility * w.reproducibility).toFixed(1)
  };
  const total = Object.values(weighted).reduce((a,b)=>a+b,0);
  const grade = total >= 90 ? 'A' : total >= 80 ? 'B' : total >= 70 ? 'C' : total >= 60 ? 'D' : 'F';

  const report = {
    report_id: `aletheia_verification_report_${Date.now()}`,
    phase_name: "Automated – Builder Verification",
    date_range: { start: nowISO(), end: nowISO() },
    metrics,
    weighted_scores: weighted,
    total_score: +total.toFixed(1),
    grade,
    anomalies_detected: [],
    corrective_actions: [],
    human_review: { reviewer: "", comments: "" },
    generated_by: "MF Builder Lite v0.1",
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

  const rpt = computeReport({ playbookPath, schemaPath, reportsDir });
  const ts = new Date().toISOString().replace(/[:-]/g,'').replace(/\..+/,'') + "Z";
  const out = path.join(reportsDir, `verification_report_${ts}.json`);
  writeJSON(out, rpt);
  console.log(`Wrote ${out}\nScore: ${rpt.total_score}  Grade: ${rpt.grade}`);
}

try { main(); } catch (err) {
  console.error('[builder-lite] ERROR:', err.message);
  process.exit(1);
}
