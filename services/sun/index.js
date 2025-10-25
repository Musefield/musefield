const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;
let hits = 0;

app.get('/', (_req, res) => res.json({ service: 'sun', status: 'ok' }));
app.get('/healthz', (_req, res) => res.send('ok'));
app.get('/metrics', (_req, res) => {
  hits++;
  res.type('text/plain').send(`sun_http_hits ${hits}\n`);
});

app.listen(PORT, () => console.log(`sun up on ${PORT}`));
