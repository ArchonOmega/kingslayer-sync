// sync.js — Project Kingslayer automated Euphoria sync
// Runs on Railway daily at 3AM UTC
// 1. Downloads DiscordChatExporter CLI
// 2. Exports Euphoria channel to JSON
// 3. Sends JSON to /api/euphoria-sync
// 4. Logs result

const { execSync, exec } = require('child_process');
const fs   = require('fs');
const path = require('path');
const https = require('https');

// ── CONFIG (set these as Railway environment variables) ──────
const DISCORD_TOKEN    = process.env.DISCORD_TOKEN;
const CHANNEL_ID       = process.env.CHANNEL_ID       || '1487918314733699092';
const KINGSLAYER_URL   = process.env.KINGSLAYER_URL    || 'https://project-kingslayer.vercel.app';
const ADMIN_USERNAME   = process.env.ADMIN_USERNAME    || 'synchandler';
const ADMIN_PASSWORD   = process.env.ADMIN_PASSWORD;
const DCE_VERSION      = process.env.DCE_VERSION       || '2.43.3';

const OUTPUT_DIR  = '/tmp/euphoria-export';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'euphoria.json');
const DCE_PATH    = '/tmp/DiscordChatExporter.CLI';

// ── Helpers ──────────────────────────────────────────────────
function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function fetchJSON(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      ...require('url').parse(url),
      method:  opts.method  || 'GET',
      headers: opts.headers || {},
    };

    const req = https.request(options, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch(e) { resolve({ status: res.statusCode, data: body }); }
      });
    });

    req.on('error', reject);
    if (opts.body) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    req.end();
  });
}

// ── Step 1: Install DiscordChatExporter CLI ──────────────────
async function installDCE() {
  if (fs.existsSync(DCE_PATH)) {
    log('DCE already installed, skipping.');
    return;
  }

  log('Installing DiscordChatExporter CLI...');
  const url = `https://github.com/Tyrrrz/DiscordChatExporter/releases/download/${DCE_VERSION}/DiscordChatExporter.CLI.linux-x64.zip`;

  execSync(`curl -L "${url}" -o /tmp/dce.zip`, { stdio: 'inherit' });
  execSync(`unzip -o /tmp/dce.zip -d /tmp/dce_extracted`, { stdio: 'inherit' });
  execSync(`cp /tmp/dce_extracted/DiscordChatExporter.CLI ${DCE_PATH}`, { stdio: 'inherit' });
  execSync(`chmod +x ${DCE_PATH}`, { stdio: 'inherit' });
  log('DCE installed.');
}

// ── Step 2: Export channel ───────────────────────────────────
async function exportChannel() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  log(`Exporting channel ${CHANNEL_ID}...`);
  execSync(
    `${DCE_PATH} export -t "${DISCORD_TOKEN}" -c ${CHANNEL_ID} -f Json -o "${OUTPUT_FILE}" --media false`,
    { stdio: 'inherit' }
  );

  // DCE may add a timestamp suffix — find the actual output file
  const files = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.json'));
  if (!files.length) throw new Error('No JSON output from DCE');

  const actualFile = path.join(OUTPUT_DIR, files[0]);
  log(`Export complete: ${actualFile} (${Math.round(fs.statSync(actualFile).size / 1024)}KB)`);
  return actualFile;
}

// ── Step 3: Login to Kingslayer ──────────────────────────────
async function login() {
  log('Logging in to Kingslayer...');
  const res = await fetchJSON(`${KINGSLAYER_URL}/api/auth?action=login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
  });

  if (res.status !== 200 || !res.data.token)
    throw new Error('Login failed: ' + JSON.stringify(res.data));

  log('Login successful.');
  return res.data.token;
}

// ── Step 4: Send to euphoria-sync ────────────────────────────
async function syncToKingslayer(filePath, token) {
  log('Reading export file...');
  const jsonContent = fs.readFileSync(filePath, 'utf8');

  log('Sending to /api/euphoria-sync...');
  const res = await fetchJSON(`${KINGSLAYER_URL}/api/euphoria-sync`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ json: jsonContent, source: 'scheduled' }),
  });

  return res;
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  log('=== Project Kingslayer — Euphoria Auto-Sync ===');

  if (!DISCORD_TOKEN) { log('ERROR: DISCORD_TOKEN not set'); process.exit(1); }
  if (!ADMIN_PASSWORD) { log('ERROR: ADMIN_PASSWORD not set'); process.exit(1); }

  try {
    await installDCE();
    const filePath = await exportChannel();
    const token    = await login();
    const result   = await syncToKingslayer(filePath, token);

    if (result.status === 200) {
      const d = result.data;
      log(`Sync complete! Parsed: ${d.parsed}, Inserted: ${d.inserted}, Updated: ${d.updated}, Skipped: ${d.skipped}`);
      if (d.errors) log('Errors: ' + JSON.stringify(d.errors));
    } else {
      log('Sync failed: ' + JSON.stringify(result.data));
      process.exit(1);
    }

    // Cleanup
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
    log('Cleanup done.');
  } catch (err) {
    log('FATAL ERROR: ' + err.message);
    console.error(err);
    process.exit(1);
  }
}

main();
