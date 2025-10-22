const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;
app.get('/', (_req, res) => res.json({ service: 'sun', status: 'ok' }));
app.listen(PORT, () => console.log(`sun up on ${PORT}`));
