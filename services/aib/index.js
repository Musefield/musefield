const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;
app.get('/', (_req, res) => res.json({ service: 'aib', status: 'ok' }));
app.listen(PORT, () => console.log(`aib up on ${PORT}`));
