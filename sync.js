// sync.js — Project Kingslayer automated Euphoria sync
process.stdout.write('[BOOT] sync.js starting\n');

const { execSync } = require('child_process');
process.stdout.write('[BOOT] child_process loaded\n');

const fs   = require('fs');
const path = require('path');
const https = require('https');
process.stdout.write('[BOOT] all modules loaded\n');

// ── CONFIG ───────────────────────────────────────────────────
const DISCORD_TOKEN  = process.env.DISCORD_TOKEN;
const CHANNEL_ID     = process.env.CHANNEL_ID     || '1487918314733699092';
const KINGSLAYER_URL = process.env.KINGSLAYER_URL  || 'https://project-kingslayer.vercel.app';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME  || 'synchandler';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

process.stdout.write('[BOOT] DISCORD_TOKEN set: ' + (DISCORD_TOKEN ? 'YES' : 'NO') + '\n');
process.stdout.write('[BOOT] ADMIN_PASSWORD set: ' + (ADMIN_PASSWORD ? 'YES' : 'NO') + '\n');
process.stdout.write('[BOOT] CHANNEL_ID: ' + CHANNEL_ID + '\n');
process.stdout.write('[BOOT] KINGSLAYER_URL: ' + KINGSLAYER_URL + '\n');

const OUTPUT_DIR = '/tmp/euphoria-export';
const DCE_PATH   = '/tmp/DiscordChatExporter.CLI';

function log(msg) {
  const line = '[' + new Date().toISOString() + '] ' + msg + '\n';
  process.stdout.write(line);
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

async function installDCE() {
  if (fs.existsSync(DCE_PATH)) {
    log('DCE already installed.');
    return;
  }
  log('Installing DiscordChatExporter CLI...');
  var version = '2.43.3';
  var zipUrl  = 'https://github.com/Tyrrrz/DiscordChatExporter/releases/download/' + version + '/DiscordChatExporter.CLI.linux-x64.zip';
  var zipPath = '/tmp/dce.zip';

  log('Downloading DCE with curl...');
  execSync('curl -L --max-time 120 --retry 3 -o "' + zipPath + '" "' + zipUrl + '"', { stdio: 'inherit' });
  log('Downloaded: ' + Math.round(fs.statSync(zipPath).size / 1024 / 1024) + 'MB');

  log('Extracting...');
  execSync('python3 -c "import zipfile; zipfile.ZipFile(\'' + zipPath + '\').extractall(\'/tmp/dce_extracted\')"', { stdio: 'inherit' });
  execSync('cp /tmp/dce_extracted/DiscordChatExporter.CLI ' + DCE_PATH);
  execSync('chmod +x ' + DCE_PATH);
  log('DCE installed.');
}

async function exportChannel() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  var existing = fs.readdirSync(OUTPUT_DIR).filter(function(f) { return f.endsWith('.json'); });
  existing.forEach(function(f) { fs.unlinkSync(path.join(OUTPUT_DIR, f)); });

  log('Exporting channel ' + CHANNEL_ID + '...');
  execSync(DCE_PATH + ' export -t "' + DISCORD_TOKEN + '" -c ' + CHANNEL_ID + ' -f Json -o "' + OUTPUT_DIR + '" --media false', { stdio: 'inherit' });

  var files = fs.readdirSync(OUTPUT_DIR).filter(function(f) { return f.endsWith('.json'); });
  if (!files.length) throw new Error('No JSON output from DCE');

  var actualFile = path.join(OUTPUT_DIR, files[0]);
  log('Export complete: ' + actualFile + ' (' + Math.round(fs.statSync(actualFile).size / 1024) + 'KB)');
  return actualFile;
}

async function login() {
  log('Logging in...');
  var res = await fetchJSON(KINGSLAYER_URL + '/api/auth?action=login', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
  });
  if (res.status !== 200 || !res.data.token)
    throw new Error('Login failed: ' + JSON.stringify(res.data));
  log('Login successful.');
  return res.data.token;
}

async function syncToKingslayer(filePath, token) {
  log('Reading export file...');
  var jsonContent = fs.readFileSync(filePath, 'utf8');
  log('File size: ' + Math.round(jsonContent.length / 1024) + 'KB');

  log('Sending to /api/euphoria-sync...');
  var res = await fetchJSON(KINGSLAYER_URL + '/api/euphoria-sync', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': 'Bearer ' + token,
    },
    body: JSON.stringify({ json: jsonContent, source: 'scheduled' }),
  });
  return res;
}

async function main() {
  log('=== Project Kingslayer — Euphoria Auto-Sync ===');

  if (!DISCORD_TOKEN)  { log('ERROR: DISCORD_TOKEN not set');  process.exit(1); }
  if (!ADMIN_PASSWORD) { log('ERROR: ADMIN_PASSWORD not set'); process.exit(1); }

  try {
    await installDCE();
    var filePath = await exportChannel();
    var token    = await login();
    var result   = await syncToKingslayer(filePath, token);

    if (result.status === 200) {
      var d = result.data;
      log('Sync complete! Parsed: ' + d.parsed + ', Inserted: ' + d.inserted + ', Updated: ' + d.updated + ', Skipped: ' + d.skipped);
      if (d.errors) log('Errors: ' + JSON.stringify(d.errors));
    } else {
      log('Sync failed: ' + JSON.stringify(result.data));
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
