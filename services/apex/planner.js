const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const IN_DIR  = '/truth';
const OUT_DIR = '/out';

function loadY(rel) {
  const p = path.join(IN_DIR, rel);
  return yaml.load(fs.readFileSync(p, 'utf8'));
}

function buildPlan() {
  const objective = loadY('objective.yaml');
  const policy    = loadY('policy.yaml');
  const world     = loadY('world_model.yaml');
  const self      = loadY('self_model.yaml');

  const cfsGuard  = (policy.gates || []).find(g => g.name === 'cfs_guard');
  const cfsMin    = cfsGuard?.target?.coherence_index_min ?? 0.70;

  return {
    version: 1,
    assume_role: 'AIB',
    prechecks: [
      "auth.has(['repo:write','deploy:canary'])",
      `cfs.coherence_index >= ${cfsMin}`
    ],
    steps: [
      { name: 'write-tests', run: "echo 'write tests stub ✅'" },
      { name: 'scaffold',    run: "echo 'scaffold apps/web services/sun services/apex ✅'" },
      { name: 'migrate',     run: "echo 'apply migrations ✅'" },
      { name: 'canary',      run: "echo 'deploy canary 1% ✅'" },
      { name: 'verify',      run: `echo 'verify CFS>=${cfsMin} ✅'` },
      { name: 'docs',        run: "echo 'docs updated ✅'" }
    ],
    on_fail: [{ when: 'verify', run: "echo 'rollback 🚒'" }],
    meta: {
      objective: objective?.objective,
      done_when: objective?.done_when ?? [],
      world_cfs: world?.cfs ?? {},
      self_id: self?.id ?? 'unknown'
    }
  };
}

function savePlan(plan) {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, 'plan.mf.yaml');
  fs.writeFileSync(outPath, yaml.dump(plan), 'utf8');
  return outPath;
}

module.exports = { buildPlan, savePlan };
