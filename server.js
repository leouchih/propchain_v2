// server.js (root) — unified KYC server
require('dotenv').config();

const fs = require('fs');
const express = require('express');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const cors = require('cors');
const { ethers } = require('ethers');
const ngrok = require('@ngrok/ngrok');

// Node 18+ has global fetch; if you're on older Node, uncomment next line:
// const fetch = require('node-fetch');

const app = express();

/* =======================
   Env & basic validation
======================= */
let {
  PORT = 4000,
  SERVER_TOKEN,
  NGROK_AUTHTOKEN,

  // Didit
  DIDIT_API_KEY,
  DIDIT_WORKFLOW_ID,
  DIDIT_WEBHOOK_SECRET,

  // Chain
  RPC_URL,
  ESCROW_ADDRESS,
  COMPLIANCE_PK,
  KYC_SALT = 'propchain-default-salt',

  // Frontend / CORS
  ALLOWED_ORIGINS = 'http://localhost:3000,http://localhost:4001',
} = process.env;

// Optional fallback: read ESCROW_ADDRESS from src/config.json (31337) if not set
if (!ESCROW_ADDRESS) {
  try {
    const cfg = JSON.parse(fs.readFileSync('./src/config.json', 'utf8'));
    const fallback = cfg['31337']?.escrow?.address;
    if (fallback) {
      ESCROW_ADDRESS = fallback;
      console.log('Using ESCROW_ADDRESS from config.json:', ESCROW_ADDRESS);
    }
  } catch (e) {
    // ignore; we'll warn below
  }
}

if (!SERVER_TOKEN) console.warn('WARN: SERVER_TOKEN is missing (API auth will fail).');
if (!DIDIT_API_KEY) console.warn('WARN: DIDIT_API_KEY is missing (Didit calls will fail).');
if (!DIDIT_WORKFLOW_ID) console.warn('WARN: DIDIT_WORKFLOW_ID is missing.');
if (!DIDIT_WEBHOOK_SECRET) console.warn('WARN: DIDIT_WEBHOOK_SECRET is missing (webhook will reject).');
if (!RPC_URL) console.warn('WARN: RPC_URL is missing (e.g., http://127.0.0.1:8545).');
if (!ESCROW_ADDRESS) console.warn('WARN: ESCROW_ADDRESS is missing (status/webhook chain ops will fail).');
if (!COMPLIANCE_PK) console.warn('WARN: COMPLIANCE_PK is missing (webhook cannot write on-chain).');

/* =========
   CORS
========= */
const origins = ALLOWED_ORIGINS.split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);         // allow tools / curl
    if (origins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'), false);
  },
  credentials: true,
}));

/* =========================================
   Webhook (HMAC, RAW body)
   POST /api/verification/webhook
========================================= */
const rawParser = bodyParser.raw({ type: '*/*' });

app.post('/api/verification/webhook', rawParser, async (req, res) => {
  try {
    // Accept both "X-Signature" and "X-Didit-Signature"
    const signature =
      req.get('x-signature') ||
      req.get('x-didit-signature') ||
      req.get('x-signature-sha256') || '';

    const timestamp = req.get('x-timestamp') || '';

    if (!signature || !process.env.DIDIT_WEBHOOK_SECRET) {
      return res.status(401).send('Missing signature or secret');
    }

    // optional freshness check (±5 min)
    const now = Math.floor(Date.now() / 1000);
    const ts = parseInt(timestamp, 10);
    if (Number.isFinite(ts) && Math.abs(now - ts) > 300) {
      return res.status(401).send('stale');
    }

    // IMPORTANT: req.body is a Buffer because of rawParser
    const computed = crypto
      .createHmac('sha256', process.env.DIDIT_WEBHOOK_SECRET)
      .update(req.body) // <-- Buffer
      .digest('hex');

    const a = Buffer.from(computed, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      console.error('[WEBHOOK] bad signature', { computed, signature });
      return res.status(401).send('bad sig');
    }

    // only now parse
    const payload = JSON.parse(req.body.toString('utf8'));

    // normalize fields from Didit payloads
    const status = String(
      payload.status || payload.decision?.status || ''
    ).toUpperCase();

    const sessionId =
      payload.session_id || payload.decision?.session_id || '';

    const userWallet =
      payload.vendor_data || payload.decision?.vendor_data || '';

    console.log('[WEBHOOK OK]', { status, sessionId, userWallet });

    if ((status === 'APPROVED' || status === 'PASSED' || status === 'VERIFIED')
        && RPC_URL && ESCROW_ADDRESS && COMPLIANCE_PK
        && ethers.utils.isAddress(userWallet)) {

      const escrow = getEscrowWithSigner();

      const hSession = ethers.utils.keccak256(Buffer.from(String(sessionId)));
      const hSalt    = ethers.utils.keccak256(Buffer.from(String(KYC_SALT)));
      const credHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(['bytes32','bytes32'], [hSession, hSalt])
      );

      const tx1 = await escrow.setAllowlist(userWallet, true); await tx1.wait();
      const tx2 = await escrow.setCredentialHash(userWallet, credHash); await tx2.wait();

      console.log(`[WEBHOOK] On-chain KYC OK for ${userWallet}`, { credHash });
    }

    // Always 200 so Didit doesn’t retry forever
    return res.status(200).send('ok');
  } catch (err) {
    console.error('[WEBHOOK] ERROR', err);
    // Still 200 to avoid retry storms; log for debugging
    return res.status(200).send('ok');
  }
});

/* ==========================
   /api auth + JSON parsing
========================== */
// Only /api/* requires Bearer; webhook uses RAW body so it's handled separately.
app.use('/api', (req, res, next) => {
  if (req.path === '/verification/webhook') return next();
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const ok = !!SERVER_TOKEN && token === SERVER_TOKEN;
  if (!ok) return res.status(401).json({ error: 'Unauthorized' });
  next();
}, express.json());

/* ==========================
   Ethers helpers
========================== */
const getEscrowWithSigner = () => {
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(COMPLIANCE_PK, provider);
  const abi = [
    'function setAllowlist(address,bool) external',
    'function setCredentialHash(address,bytes32) external',
    'function isAllowlisted(address) view returns (bool)',
  ];
  return new ethers.Contract(ESCROW_ADDRESS, abi, wallet);
};

const getEscrowReadOnly = () => {
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const abi = ['function isAllowlisted(address) view returns (bool)'];
  return new ethers.Contract(ESCROW_ADDRESS, abi, provider);
};

/* ===========
   Health
=========== */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

/* =========================================
   Create Didit verification session (v2)
   POST /api/verification/session
========================================= */
app.post('/api/verification/session', async (req, res) => {
  console.log('[SESSION] incoming', { body: req.body });

  try {
    const { userRef, callback, metadata } = req.body || {};

    if (!userRef) return res.status(400).json({ error: 'userRef is required (suggest wallet address)' });
    if (!DIDIT_WORKFLOW_ID) return res.status(500).json({ error: 'DIDIT_WORKFLOW_ID missing' });
    if (!DIDIT_API_KEY) return res.status(500).json({ error: 'DIDIT_API_KEY missing' });

    const payload = {
      workflow_id: DIDIT_WORKFLOW_ID,           // UUID per Didit docs
      vendor_data: userRef,                     // map to wallet
      ...(callback ? { callback } : {}),
      ...(metadata ? { metadata: String(metadata) } : {}),
    };

    console.log('[SESSION] calling Didit', {
      endpoint: 'https://verification.didit.me/v2/session/',
      payload,
      apiKeyPresent: !!DIDIT_API_KEY,
    });

    const resp = await fetch('https://verification.didit.me/v2/session/', {
      method: 'POST',
      headers: {
        'x-api-key': DIDIT_API_KEY,
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const raw = await resp.text();
    console.log('[SESSION] Didit response', { status: resp.status, raw });

    let data; try { data = JSON.parse(raw); } catch { data = raw; }

    if (!resp.ok) {
      return res.status(resp.status).json({
        error: 'Didit session creation failed',
        details: typeof data === 'string' ? data : JSON.stringify(data),
      });
    }

    // Accept common response field variants
    const sessionUrl = data?.url || data?.session_url || data?.sessionUrl || data?.link;
    const requestId = data?.id || data?.requestId || data?.sessionId || null;

    if (!sessionUrl) {
      return res.status(502).json({ error: 'Didit did not return a session URL', raw: data });
    }

    return res.json({ sessionUrl, requestId });
  } catch (err) {
    console.error('[SESSION] ERROR', err);
    return res.status(500).json({ error: 'Internal error creating session', detail: String(err?.message || err) });
  }
});

/* =========================================
   Status: read allowlist from chain
   GET /api/verification/status/:wallet
========================================= */
app.get('/api/verification/status/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;
    if (!ethers.utils.isAddress(wallet)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }
    if (!RPC_URL || !ESCROW_ADDRESS) {
      return res.status(500).json({ error: 'Server not configured for chain access' });
    }
    const escrow = getEscrowReadOnly();
    const ok = await escrow.isAllowlisted(wallet);
    return res.json({ wallet, status: ok ? 'VERIFIED' : 'UNVERIFIED' });
  } catch (err) {
    console.error('STATUS ERROR:', err);
    return res.status(500).json({ error: 'Internal error checking status' });
  }
});




/* ==================
   Start server
================== */
async function start() {
  app.listen(PORT, async () => {
    console.log(`KYC server listening on http://localhost:${PORT}`);

    if (NGROK_AUTHTOKEN) {
      try {
        const listener = await ngrok.connect({ addr: PORT, authtoken: NGROK_AUTHTOKEN });
        console.log(`ngrok public URL: ${listener.url()}`);
        console.log(`Set Didit webhook URL to: ${listener.url()}/api/verification/webhook`);
      } catch (e) {
        console.error('ngrok error:', e);
      }
    }
  });
}

start();
