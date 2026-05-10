// sync.js — Project Kingslayer automated Euphoria sync
process.stdout.write('[BOOT] sync.js starting\n');

const { execSync } = require('child_process');
const fs    = require('fs');
const path  = require('path');
const https = require('https');

process.stdout.write('[BOOT] modules loaded\n');

// ── CONFIG ───────────────────────────────────────────────────
const DISCORD_TOKEN  = process.env.DISCORD_TOKEN;
const CHANNEL_ID     = process.env.CHANNEL_ID     || '1487918314733699092';
const KINGSLAYER_URL = process.env.KINGSLAYER_URL || 'https://project-kingslayer.vercel.app';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'synchandler';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

process.stdout.write('[BOOT] DISCORD_TOKEN: ' + (DISCORD_TOKEN ? 'YES' : 'NO') + '\n');
process.stdout.write('[BOOT] ADMIN_PASSWORD: ' + (ADMIN_PASSWORD ? 'YES' : 'NO') + '\n');

const OUTPUT_DIR = '/tmp/euphoria-export';

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

  log('Exporting channel ' + CHANNEL_ID + '...');
  // The official DCE image places the CLI at /app/DiscordChatExporter.Cli.dll
  // We invoke via dotnet runtime
  execSync(
    '/opt/dce/DiscordChatExporter.Cli export ' +
    '-t "' + DISCORD_TOKEN + '" ' +
    '-c ' + CHANNEL_ID + ' ' +
    '-f Json ' +
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

async function main() {
  log('=== Project Kingslayer — Euphoria Auto-Sync ===');
  if (!DISCORD_TOKEN)  { log('ERROR: DISCORD_TOKEN not set');  process.exit(1); }
  if (!ADMIN_PASSWORD) { log('ERROR: ADMIN_PASSWORD not set'); process.exit(1); }

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
      body: JSON.stringify({ json: content, source: 'scheduled' }),
    });

    if (res.status === 200) {
      var d = res.data;
      log('Sync complete! Parsed:' + d.parsed + ' New:' + d.inserted + ' Updated:' + d.updated + ' Skipped:' + d.skipped);
      if (d.errors) log('Errors: ' + JSON.stringify(d.errors));
    } else {
      log('Sync failed: ' + JSON.stringify(res.data));
      process.exit(1);
    }

    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
    log('Done.');
  } catch(err) {
    log('FATAL: ' + err.message);
    console.error(err);
    process.exit(1);
  }
}

main();
