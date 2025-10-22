const { spawn } = require('child_process');

function runCmd(cmd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, { shell: true });
    let out = "", err = "";
    child.stdout.on('data', d => out += d.toString());
    child.stderr.on('data', d => err += d.toString());
    child.on('close', code => {
      if (code === 0) resolve({ code, out });
      else reject(new Error(err || `exit ${code}`));
    });
  });
}

async function runPlan(plan) {
  const results = [];
  for (const step of (plan.steps || [])) {
    const r = await runCmd(step.run);
    results.push({ name: step.name, ok: true, out: r.out.trim() });
  }
  return results;
}

module.exports = { runPlan };
