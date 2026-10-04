// Run with: npm test   (uses the built-in node:test runner, no extra dependencies)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

process.env.NODE_ENV = 'production';
delete process.env.JOURNAL_API_KEY;
const app = require('../app');

function request(server, method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      { host: '127.0.0.1', port, method, path: url, headers: { 'content-type': 'application/json', ...headers } },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('server', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());

  await t.test('serves the app with security headers', async () => {
    const r = await request(server, 'GET', '/');
    assert.strictEqual(r.status, 200);
    assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
    assert.strictEqual(r.headers['x-powered-by'], undefined);
  });

  await t.test('healthz responds', async () => {
    const r = await request(server, 'GET', '/healthz');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(JSON.parse(r.body).status, 'ok');
  });

  await t.test('/journal/save is disabled without JOURNAL_API_KEY', async () => {
    const r = await request(server, 'POST', '/journal/save', { date: '2026-01-01', content: 'x' });
    assert.strictEqual(r.status, 404);
  });

  await t.test('/journal/save rejects bad keys and path traversal', async () => {
    process.env.JOURNAL_API_KEY = 'test-key-123';
    process.env.GITHUB_REPO = 'owner/repo';
    process.env.GITHUB_TOKEN = 'dummy';
    try {
      const noAuth = await request(server, 'POST', '/journal/save', { date: '2026-01-01', content: 'x' });
      assert.strictEqual(noAuth.status, 401);
      const bad = await request(server, 'POST', '/journal/save', { date: '../../README', content: 'x' },
        { authorization: 'Bearer test-key-123' });
      assert.strictEqual(bad.status, 400);
    } finally {
      delete process.env.JOURNAL_API_KEY;
    }
  });

  await t.test('error pages do not leak stack traces', async () => {
    const r = await request(server, 'GET', '/does-not-exist');
    assert.strictEqual(r.status, 404);
    assert.doesNotMatch(r.body, /at .*\.js:\d+/);
  });
});

test('markdown renderer blocks dangerous URL schemes', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const lines = html.split('\n').filter((l) => l.startsWith('function mdSafeUrl') || l.startsWith('function mdInline'));
  assert.strictEqual(lines.length, 2, 'mdSafeUrl and mdInline must exist');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mdInline = new Function('esc', lines.join('\n') + ';return mdInline')(esc);
  const render = (s) => mdInline(esc(s));

  for (const bad of ['[a](javascript:alert(1))', '[a](JavaScript:x)', '[a](vbscript:x)', '[a](data:text/html,x)']) {
    assert.match(render(bad), /href="#"/, bad);
  }
  assert.match(render('[a](https://example.com)'), /href="https:\/\/example.com"/);
  assert.match(render('[a](notes/x.md)'), /href="notes\/x.md"/);
  assert.match(render('![i](data:image/png;base64,AAAA)'), /src="data:image\/png/);
  assert.match(render('<img src=x onerror=alert(1)>'), /^&lt;img/);
});
