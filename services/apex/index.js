const express = require('express');
const fs = require('fs');
const yaml = require('js-yaml');
const { buildPlan, savePlan } = require('./planner');
const { append } = require('./ledger');
const { runPlan } = require('./runner');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 8082;

function flagsEnabled() {
  try {
    const flags = JSON.parse(fs.readFileSync('/app/../config/flags.json','utf8'));
    return !!(flags.builder && flags.builder.enabled);
  } catch { return false; }
}

let hits = 0;

app.get('/', (_req, res) => res.json({ service: 'apex', status: 'ok' }));
app.get('/healthz', (_req, res) => res.send('ok'));
app.get('/metrics', (_req, res) => { hits++; res.type('text/plain').send(`apex_http_hits ${hits}\n`); });

app.post('/plan', (_req, res) => {
  try {
    const plan = buildPlan();
    const where = savePlan(plan);
    append({ ts: new Date().toISOString(), action: "plan_generated", file: where, steps: plan.steps?.length || 0 });
    res.json({ ok: true, saved: where, plan, mode: flagsEnabled() ? "execute" : "simulate" });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/execute', async (_req, res) => {
  try {
    const plan = yaml.load(fs.readFileSync('/out/plan.mf.yaml', 'utf8'));
    if (!flagsEnabled()) {
      const wouldRun = (plan.steps || []).map(s => s.run);
      append({ ts: new Date().toISOString(), action: "plan_execute_simulated", steps: wouldRun.length });
      return res.json({ ok: true, steps: wouldRun, note: "simulation only (builder.disabled)" });
    }
    const results = await runPlan(plan);
    append({ ts: new Date().toISOString(), action: "plan_executed", steps: results.length });
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.listen(PORT, () => console.log(`apex up on ${PORT}`));
