const express = require("express");
const bodyParser = require("body-parser");
const { Client, GatewayIntentBits } = require("discord.js");
const { spawn } = require('child_process');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

let bots = {}; // store running bots by token (either discord client or docker container info)

app.post('/start', (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== 'string') return res.status(400).send('Token required');
  if (token.length < 8) return res.status(400).send('Token too short');

  if (bots[token]) return res.status(409).send('Bot already running');

  // create a safe container name from a hash of the token
  const containerName = 'bot_' + crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);

  // check if a container with that name already exists
  const ps = spawn('docker', ['ps', '-a', '--filter', `name=^/${containerName}$`, '--format', '{{.ID}}']);
  let psOut = '';
  let psErr = '';
  ps.stdout.on('data', d => psOut += d.toString());
  ps.stderr.on('data', d => psErr += d.toString());
  ps.on('close', () => {
    if (psErr) {
      console.error('docker ps error:', psErr);
      return res.status(500).send('Docker error');
    }
    if (psOut.trim()) return res.status(409).send('Container already exists: ' + containerName);

    // run the container, pass token via environment variable
    const args = ['run', '-d', '--name', containerName, '-e', `BOT_TOKEN=${token}`, 'botcraft-bot'];
    const run = spawn('docker', args);
    let out = '';
    let err = '';
    run.stdout.on('data', d => out += d.toString());
    run.stderr.on('data', d => err += d.toString());
    run.on('close', (code) => {
      if (code !== 0) {
        console.error('docker run failed:', err);
        return res.status(500).send('Failed to start bot: ' + (err || 'unknown'));
      }
      const containerId = out.trim();
      bots[token] = { containerName, containerId };
      res.status(201).send({ containerName, containerId });
    });
  });
});

app.post('/stop', (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== 'string') return res.status(400).send('Token required');

  const info = bots[token];
  if (!info) return res.status(400).send('Bot not running');

  // If this is a docker-managed bot
  if (info.containerName) {
    const rm = spawn('docker', ['rm', '-f', info.containerName]);
    let out = '';
    let err = '';
    rm.stdout.on('data', d => out += d.toString());
    rm.stderr.on('data', d => err += d.toString());
    rm.on('close', code => {
      if (code !== 0) {
        console.error('docker rm failed:', err);
        return res.status(500).send('Failed to stop container: ' + (err || 'unknown'));
      }
      delete bots[token];
      res.send('Bot container stopped and removed');
    });
    return;
  }

  // If this is an in-process Discord client
  if (info && typeof info.destroy === 'function') {
    try {
      info.destroy();
    } catch (e) {
      console.error('Error destroying client:', e);
    }
    delete bots[token];
    return res.send('Bot stopped successfully!');
  }

  // Fallback: remove record
  delete bots[token];
  res.send('Bot record removed');
});

// Healthcheck endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// OAuth2 callback route for bot installation
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  const state = req.query.state; // optional: validate against stored state for CSRF
  if (!code) return res.status(400).send('No code provided');

  try {
    const data = new URLSearchParams({
      client_id: process.env.CLIENT_ID || '',
      client_secret: process.env.CLIENT_SECRET || '',
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.OAUTH_REDIRECT_URI || 'https://botcraft.dev/callback',
    });

    const response = await axios.post('https://discord.com/api/oauth2/token', data.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    });

    const { access_token } = response.data;

    const user = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` },
      timeout: 10000,
    });

    console.log('User authorized:', { id: user.data.id, username: user.data.username });

    res.send('Bot added successfully!');
  } catch (err) {
    console.error('OAuth2 error:', err.response && err.response.data ? err.response.data : err.message);
    res.status(500).send('OAuth2 failed');
  }
});

app.listen(3000, () => console.log("Server running on http://localhost:3000"));

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});