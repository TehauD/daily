require('dotenv').config();
var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');

var app = express();

// Never log secrets. Only report whether optional server-side config is present.
if (process.env.GITHUB_TOKEN) {
  console.log('[config] GITHUB_TOKEN is set (value hidden).');
}

const journalRouter = require('./routes/journal');

const isProd = app.get('env') === 'production';

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.disable('x-powered-by');
// Azure App Service and most hosts terminate TLS at a proxy.
app.set('trust proxy', 1);

// Baseline security headers (no extra dependency).
// The SPA uses inline <script>/<style>, so 'unsafe-inline' is required for now.
// connect-src must allow the providers a user may configure (GitHub, Azure DevOps,
// OpenAI-compatible endpoints, and a local relay / LM Studio / Ollama).
// Tighten EXTRA_CONNECT_SRC / remove entries you don't use.
const extraConnect = (process.env.EXTRA_CONNECT_SRC || '').split(/\s+/).filter(Boolean);
const connectSrc = [
  "'self'",
  'https://api.github.com',
  'https://dev.azure.com',
  'https://api.openai.com',
  'https://*.openai.azure.com',
  'https://*.services.ai.azure.com',
  'http://localhost:*',
  'http://127.0.0.1:*',
  ...extraConnect,
].join(' ');
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src ${connectSrc}`,
  "frame-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

app.use(function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use(logger(isProd ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', function (req, res) {
  res.json({ status: 'ok', provider: 'express' });
});

app.use('/journal', journalRouter);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler — never expose stack traces outside development
app.use(function (err, req, res, next) {
  const status = err.status || 500;
  if (status >= 500) console.error(`[${req.method}] ${req.originalUrl} -> ${status}: ${err.message}`);
  res.locals.message = status >= 500 && isProd ? 'Something went wrong' : err.message;
  res.locals.error = app.get('env') === 'development' ? err : {};

  res.status(status);
  res.render('error');
});

module.exports = app;
