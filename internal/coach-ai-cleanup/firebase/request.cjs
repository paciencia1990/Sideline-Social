'use strict';
const {Readable} = require('node:stream');

const CRITICAL = new Set(['authorization', 'content-type', 'content-length', 'content-encoding',
  'cookie', 'origin', 'x-serverless-authorization', 'x-cloudscheduler',
  'x-cloudscheduler-jobname', 'x-cloudscheduler-scheduletime']);

function deny(message, status) {throw Object.assign(Error(message), {status});}

// Firebase's framework has already consumed/parses the request stream. Replay
// only its original rawBody to the existing Node handlers; never trust req.body
// or read the original stream again. The byte limit is a business-handler bound,
// not a claim that the managed framework never buffered a larger request.
function bufferedFirebaseRequest(req, {kind}) {
  if (kind !== 'console' && kind !== 'observer') throw Error('cleanup_request_kind');
  if (req.aborted === true) deny('cleanup_request_stopped', 409);
  const method = req.method;
  const url = req.originalUrl === undefined ? req.url : req.originalUrl;
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//') || /[\\\r\n]/.test(url)) {
    deny('not_found', 404);
  }
  let handlerUrl = url;
  if (kind === 'console') {
    const get = new Set(['/', '/index.html', '/style.css', '/staff-view.js', '/client.js', '/page.js',
      '/login.js', '/login-page.js', '/login-config.js', '/healthz', '/action.html', '/action-client.js', '/action-page.js']);
    if (!(method === 'GET' && get.has(url) || method === 'POST'
      && ['/internal/coach-ai-cleanup','/internal/coach-ai-cleanup-action'].includes(url))) {
      deny('not_found', 404);
    }
  } else {
    // The private scheduled target is the bare Function URL. This explicit
    // adapter maps its root POST to the existing observer's fixed local route.
    if (method === 'POST' && url === '/') handlerUrl = '/observe';
    else if (!(method === 'GET' && url === '/healthz')) deny('not_found', 404);
  }
  if (!req.headers || typeof req.headers !== 'object' || !Array.isArray(req.rawHeaders)
    || req.rawHeaders.length % 2 !== 0) deny('cleanup_request_denied', 403);
  const seen = new Set();
  for (let n = 0; n < req.rawHeaders.length; n += 2) {
    if (typeof req.rawHeaders[n] !== 'string' || typeof req.rawHeaders[n + 1] !== 'string') {
      deny('cleanup_request_denied', 403);
    }
    const name = req.rawHeaders[n].toLowerCase();
    if (CRITICAL.has(name)) {
      if (seen.has(name)) deny('cleanup_request_denied', 403);
      seen.add(name);
    }
  }
  const headers = {...req.headers};
  for (const name of CRITICAL) {
    if (headers[name] !== undefined && typeof headers[name] !== 'string') deny('cleanup_request_denied', 403);
  }
  if (headers['content-encoding'] !== undefined || headers['x-serverless-authorization'] !== undefined) {
    deny('cleanup_request_denied', 403);
  }
  let bytes = req.rawBody;
  if (method === 'POST' && !Buffer.isBuffer(bytes)) deny('invalid_json', 400);
  if (bytes === undefined && method === 'GET') bytes = Buffer.alloc(0);
  if (!Buffer.isBuffer(bytes)) deny('cleanup_request_denied', 403);
  const maximum = method === 'GET' ? 0 : kind === 'console' ? 16384 : 256;
  if (bytes.length > maximum) deny('request_too_large', 413);
  const declared = headers['content-length'];
  if (declared !== undefined && (!/^(0|[1-9][0-9]*)$/.test(declared)
    || !Number.isSafeInteger(Number(declared)) || Number(declared) !== bytes.length)) {
    deny('cleanup_request_denied', 403);
  }
  const stream = Readable.from(bytes.length ? [Buffer.from(bytes)] : []);
  Object.assign(stream, {method, url: handlerUrl, headers: Object.freeze(headers),
    rawHeaders: [...req.rawHeaders], complete: true});
  const abort = () => {stream.emit('aborted'); stream.destroy();};
  req.once('aborted', abort);
  return {request: stream, dispose() {req.removeListener('aborted', abort); stream.destroy();}};
}

function replyStopped(res, error) {
  if (res.destroyed || res.writableEnded) return;
  const allowed = new Set(['not_found', 'cleanup_request_stopped', 'cleanup_request_denied', 'invalid_json', 'request_too_large']);
  const known = allowed.has(error?.message);
  const status = known && [400, 403, 404, 409, 413].includes(error.status) ? error.status : 503;
  res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"});
  res.end(JSON.stringify({error: known ? error.message : 'cleanup_configuration_stopped'}));
}

module.exports = {bufferedFirebaseRequest, replyStopped};
