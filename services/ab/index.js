const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;
app.get('/', (_req, res) => res.json({ service: 'ab', status: 'ok' }));
app.listen(PORT, () => console.log(`ab up on ${PORT}`));
