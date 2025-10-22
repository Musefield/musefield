const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const OUT_LEDGER = '/out/ethical_ledger.yaml';

function append(entry) {
  // naive YAML append: read, push, write
  let items = [];
  try { items = yaml.load(fs.readFileSync(OUT_LEDGER, 'utf8')) || []; } catch {}
  items.push(entry);
  fs.writeFileSync(OUT_LEDGER, yaml.dump(items), 'utf8');
}

module.exports = { append };
