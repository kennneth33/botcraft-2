const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('No code provided');

  try {
    const params = new URLSearchParams({
      client_id: process.env.CLIENT_ID || '',
      client_secret: process.env.CLIENT_SECRET || '',
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.OAUTH_REDIRECT_URI || 'https://botcraft.dev/callback',
    });

    const tokenRes = await axios.post('https://discord.com/api/oauth2/token', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    });

    const { access_token } = tokenRes.data;

    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` },
      timeout: 10000,
    });

    console.log('User authorized:', { id: userRes.data.id, username: userRes.data.username });

    res.send('Bot added successfully!');
  } catch (err) {
    console.error('OAuth2 failed:', err.response && err.response.data ? err.response.data : err.message);
    res.status(500).send('OAuth2 failed');
  }
});

app.listen(PORT, () => console.log(`OAuth2 server running on port ${PORT}`));
