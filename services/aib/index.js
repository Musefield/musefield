const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;
let hits = 0;

app.get('/', (_req, res) => res.json({ service: 'aib', status: 'ok' }));
app.get('/healthz', (_req, res) => res.send('ok'));
app.get('/metrics', (_req, res) => { hits++; res.type('text/plain').send(`aib_http_hits ${hits}\n`); });

app.listen(PORT, () => console.log(`aib up on ${PORT}`));
