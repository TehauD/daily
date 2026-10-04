/*
 * Legacy server-side save endpoint: POST /journal/save
 *
 * The single-page app in public/index.html does NOT use this route — it talks to
 * GitHub / Azure DevOps directly from the browser (or through the local relay).
 *
 * Because this route writes to a GitHub repository with a server-held token, it is
 * DISABLED unless JOURNAL_API_KEY is set, and every request must then send
 *   Authorization: Bearer <JOURNAL_API_KEY>
 * Without that gate, anyone who could reach the server could write into your repo.
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const axios = require('axios');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CONTENT_BYTES = 512 * 1024;

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function requireApiKey(req, res, next) {
  const expected = process.env.JOURNAL_API_KEY;
  if (!expected) return res.status(404).json({ error: 'Not found' });
  const header = req.get('authorization') || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!supplied || !safeEqual(supplied, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.post('/save', requireApiKey, async (req, res) => {
  const { date, content } = req.body || {};
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  const token = process.env.GITHUB_TOKEN;

  if (!repo || !token) {
    return res.status(503).json({ error: 'Server save is not configured' });
  }
  if (typeof date !== 'string' || !DATE_RE.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  if (typeof content !== 'string' || !content.length) {
    return res.status(400).json({ error: 'Missing content' });
  }
  if (Buffer.byteLength(content) > MAX_CONTENT_BYTES) {
    return res.status(413).json({ error: 'Content too large' });
  }

  const path = `journal_entries/${date}.md`;
  const encoded = Buffer.from(content).toString('base64');
  const headers = {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'veritas-journal-app',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const url = `https://api.github.com/repos/${repo}/contents/${path}`;

  let sha;
  try {
    const existing = await axios.get(url, { headers, params: { ref: branch }, timeout: 15000 });
    sha = existing.data.sha;
  } catch (err) {
    if (err.response?.status !== 404) {
      console.error('[journal/save] lookup failed:', err.response?.status || err.code);
      return res.status(502).json({ error: 'Upstream lookup failed' });
    }
  }

  try {
    await axios.put(
      url,
      {
        message: `Journal entry for ${date}`,
        content: encoded,
        branch,
        ...(sha && { sha }),
      },
      { headers, timeout: 15000 }
    );
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('[journal/save] write failed:', err.response?.status || err.code);
    res.status(502).json({ error: 'Upstream write failed' });
  }
});

module.exports = router;
