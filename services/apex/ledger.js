const fs = require('fs');
const yaml = require('js-yaml');
const OUT_LEDGER = '/out/ethical_ledger.yaml';

function append(entry) {
  let items = [];
  try { items = yaml.load(fs.readFileSync(OUT_LEDGER, 'utf8')) || []; } catch {}
  items.push(entry);
  fs.writeFileSync(OUT_LEDGER, yaml.dump(items), 'utf8');
}
module.exports = { append };
