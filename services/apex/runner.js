const { spawn } = require('child_process');

function runCmd(cmd, cwd='/repo') {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, {
      shell: true,
      cwd,
      env: {
        ...process.env,
        GIT_SSH_COMMAND: 'ssh -i /home/node/.ssh/id_ed25519 -o StrictHostKeyChecking=accept-new'
      }
    });
    let out = "", err = "";
    child.stdout.on('data', d => out += d.toString());
    child.stderr.on('data', d => err += d.toString());
    child.on('close', code => code === 0 ? resolve({ code, out }) : reject(new Error(err || `exit ${code}`)));
  });
}

async function ensureGitSafe() {
  // Idempotent and cheap; run before any git action
  await runCmd('git config --global --add safe.directory /repo');
}

async function runPlan(plan) {
  const results = [];
  for (const step of (plan.steps || [])) {
    let cmd = step.run;

    // tiny DSL: commit/push steps
    if (step.commit) {
      await ensureGitSafe();
      cmd = `git add -A && git commit -m ${JSON.stringify(step.commit)}`;
    }
    if (step.push) {
      await ensureGitSafe();
      cmd = `git push origin ${step.push}`;
    }

    const r = await runCmd(cmd);
    results.push({ name: step.name || step.commit || step.push || step.run, ok: true, out: r.out.trim() });
  }
  return results;
}

module.exports = { runCmd, runPlan };
