// sync.js — Project Kingslayer Euphoria sync service
// Runs as a long-lived web service on Railway.
// Internal cron fires daily at 3AM UTC. HTTP /run endpoint allows manual triggers.

process.stdout.write('[BOOT] sync.js starting\n');

const { execSync } = require('child_process');
const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');
const cron  = require('node-cron');

process.stdout.write('[BOOT] modules loaded\n');

// ── CONFIG ───────────────────────────────────────────────────
const DISCORD_TOKEN  = process.env.DISCORD_TOKEN;
const CHANNEL_ID     = process.env.CHANNEL_ID     || '1487918314733699092';
const KINGSLAYER_URL = process.env.KINGSLAYER_URL || 'https://project-kingslayer.vercel.app';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'synchandler';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const TRIGGER_SECRET = process.env.TRIGGER_SECRET || 'change-me';
const PORT           = process.env.PORT            || 3000;

process.stdout.write('[BOOT] DISCORD_TOKEN: ' + (DISCORD_TOKEN ? 'YES' : 'NO') + '\n');
process.stdout.write('[BOOT] ADMIN_PASSWORD: ' + (ADMIN_PASSWORD ? 'YES' : 'NO') + '\n');

const OUTPUT_DIR = '/tmp/euphoria-export';

let syncInProgress = false;
let lastSyncResult = null;
let lastSyncTime   = null;

function log(msg) {
  process.stdout.write('[' + new Date().toISOString() + '] ' + msg + '\n');
}

function fetchJSON(url, opts) {
  opts = opts || {};
  return new Promise(function(resolve, reject) {
    var urlObj  = new URL(url);
    var options = {
      hostname: urlObj.hostname,
      path:     urlObj.pathname + urlObj.search,
      method:   opts.method  || 'GET',
      headers:  opts.headers || {},
    };
    var req = https.request(options, function(res) {
      var body = '';
      res.on('data', function(d) { body += d; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch(e) { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    req.end();
  });
}

async function exportChannel() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.readdirSync(OUTPUT_DIR).filter(function(f) { return f.endsWith('.json'); })
    .forEach(function(f) { fs.unlinkSync(path.join(OUTPUT_DIR, f)); });

  // Rolling window: only export the last SYNC_WINDOW_DAYS days of messages.
  // This keeps the payload small so it never exceeds Vercel's request limit,
  // no matter how large the total channel history grows. The sync dedupes by
  // region and only applies newer timestamps, so not re-sending old history
  // is safe — those lands are already in the database.
  var windowDays = parseInt(process.env.SYNC_WINDOW_DAYS || '14', 10);
  var afterDate = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  // DCE accepts an ISO-style date; use YYYY-MM-DD.
  var afterStr = afterDate.toISOString().slice(0, 10);

  log('Exporting channel ' + CHANNEL_ID + ' (messages after ' + afterStr + ')...');
  execSync(
    '/opt/dce/DiscordChatExporter.Cli export ' +
    '-t "' + DISCORD_TOKEN + '" ' +
    '-c ' + CHANNEL_ID + ' ' +
    '-f Json ' +
    '--after "' + afterStr + '" ' +
    '-o "' + OUTPUT_DIR + '" ' +
    '--media false',
    { stdio: 'inherit' }
  );

  var files = fs.readdirSync(OUTPUT_DIR).filter(function(f) { return f.endsWith('.json'); });
  if (!files.length) throw new Error('No JSON output from DCE');
  var file = path.join(OUTPUT_DIR, files[0]);
  log('Exported: ' + Math.round(fs.statSync(file).size / 1024) + 'KB');
  return file;
}

async function login() {
  log('Logging in to Kingslayer...');
  var res = await fetchJSON(KINGSLAYER_URL + '/api/auth?action=login', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
  });
  if (res.status !== 200 || !res.data.token)
    throw new Error('Login failed: ' + JSON.stringify(res.data));
  log('Logged in.');
  return res.data.token;
}

async function runSync(source) {
  if (syncInProgress) {
    log('Sync already in progress — skipping.');
    return { ok: false, error: 'Sync already in progress' };
  }
  syncInProgress = true;
  source = source || 'scheduled';
  log('=== Starting sync (source=' + source + ') ===');

  try {
    var file  = await exportChannel();
    var token = await login();
    log('Sending to euphoria-sync...');
    var content = fs.readFileSync(file, 'utf8');
    var res = await fetchJSON(KINGSLAYER_URL + '/api/euphoria-sync', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({ json: content, source: source }),
    });

    if (res.status === 200) {
      var d = res.data;
      log('Sync complete! Parsed:' + d.parsed + ' New:' + d.inserted + ' Updated:' + d.updated + ' Skipped:' + d.skipped);
      lastSyncResult = d;
      lastSyncTime   = new Date().toISOString();
      fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
      return { ok: true, ...d };
    } else {
      log('Sync failed: ' + JSON.stringify(res.data));
      lastSyncResult = { error: res.data };
      lastSyncTime   = new Date().toISOString();
      return { ok: false, error: res.data };
    }
  } catch(err) {
    log('FATAL: ' + err.message);
    console.error(err);
    lastSyncResult = { error: err.message };
    lastSyncTime   = new Date().toISOString();
    return { ok: false, error: err.message };
  } finally {
    syncInProgress = false;
  }
}

// ── HTTP server ──────────────────────────────────────────────
const server = http.createServer(function(req, res) {
  // Health check / status
  if (req.url === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      service: 'kingslayer-sync',
      status:  syncInProgress ? 'syncing' : 'idle',
      lastSyncTime,
      lastSyncResult,
    }));
  }

  // Manual trigger
  if (req.url.startsWith('/run') && req.method === 'POST') {
    var url = new URL(req.url, 'http://localhost');
    var secret = req.headers['x-trigger-secret'] || url.searchParams.get('secret');

    if (secret !== TRIGGER_SECRET) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Unauthorized' }));
    }

    log('Manual trigger received');
    // Fire and respond immediately — don't make caller wait for full sync
    runSync('manual').then(function(result) {
      log('Manual sync completed.');
    }).catch(function(err) {
      log('Manual sync errored: ' + err.message);
    });

    res.writeHead(202, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ok:      true,
      message: 'Sync triggered. Check sync history on the Kingslayer site for results.',
    }));
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, function() {
  log('HTTP server listening on port ' + PORT);
});

// ── Daily cron at 3AM UTC ────────────────────────────────────
cron.schedule('0 3 * * *', function() {
  log('Scheduled cron firing.');
  runSync('scheduled');
}, { timezone: 'UTC' });

log('Service ready. Daily sync at 03:00 UTC. Manual trigger via POST /run.');
