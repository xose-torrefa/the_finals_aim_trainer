// Servidor estático mínimo, sin dependencias. Solo escucha en loopback y solo
// sirve una lista blanca de rutas (nada de listar node_modules entero).
import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 5173;

// Rutas exactas -> fichero
const FILES = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/styles.css': 'styles.css',
};

// Prefijos de URL -> directorio. Solo se sirve el build de three, no el paquete completo.
const MOUNTS = [
  ['/src/', path.join(ROOT, 'src')],
  ['/lib/three/', path.join(ROOT, 'node_modules', 'three', 'build')],
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=(), serial=(), hid=()',
  'Cache-Control': 'no-store',
};

// Evita DNS rebinding: solo aceptamos peticiones dirigidas a localhost.
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

function isInside(dir, file) {
  return file.startsWith(dir + path.sep);
}

async function resolveFile(urlPath) {
  if (Object.hasOwn(FILES, urlPath)) return path.join(ROOT, FILES[urlPath]);
  for (const [prefix, dir] of MOUNTS) {
    if (!urlPath.startsWith(prefix)) continue;
    const full = path.resolve(dir, '.' + urlPath.slice(prefix.length - 1));
    if (!isInside(dir, full)) return null;
    // Rechaza symlinks que apunten fuera del directorio montado
    const real = await realpath(full).catch(() => null);
    const realDir = await realpath(dir).catch(() => null);
    if (!real || !realDir || !isInside(realDir, real)) return null;
    return real;
  }
  return null;
}

function send(res, status, headers = {}, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (!ALLOWED_HOSTS.has(req.headers.host ?? '')) return send(res, 421);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { Allow: 'GET, HEAD' });

  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400);
  }
  if (urlPath.includes('\0') || urlPath.includes('\\')) return send(res, 400);

  const file = await resolveFile(urlPath);
  const type = file && MIME[path.extname(file)];
  if (!type) return send(res, 404);

  try {
    const body = await readFile(file);
    send(res, 200, { 'Content-Type': type }, req.method === 'HEAD' ? undefined : body);
  } catch {
    send(res, 404);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Finals Aim -> http://localhost:${PORT}`);
});
