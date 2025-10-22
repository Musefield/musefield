const express = require('express');
const app = express();
const PORT = process.env.PORT || 8082;
app.get('/', (_req, res) => res.json({ service: 'apex', status: 'ok' }));
app.listen(PORT, () => console.log(`apex up on ${PORT}`));
