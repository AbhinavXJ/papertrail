// Static server for the exported app (out/) that sends the same headers as vercel.json,
// so local testing runs under the production Content Security Policy.
// Usage: node scripts/serve.mjs [port]
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "out");
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 3000);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".gz": "application/gzip",
  ".bcmap": "application/octet-stream",
  ".pfb": "application/octet-stream",
  ".ttf": "font/ttf",
  ".icc": "application/vnd.iccprofile",
};

const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));
const rules = (vercel.headers ?? []).map((h) => ({ re: new RegExp(`^${h.source}$`), headers: h.headers }));

function headersFor(pathname) {
  const out = {};
  for (const r of rules) if (r.re.test(pathname)) for (const h of r.headers) out[h.key.toLowerCase()] = h.value;
  return out;
}

export function startServer(port = PORT) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    let file = join(ROOT, p);
    if (!file.startsWith(ROOT)) return res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    else if (!existsSync(file) && existsSync(`${file}.html`)) file += ".html";
    const extra = headersFor(url.pathname);
    if (!existsSync(file)) {
      res.writeHead(404, { "content-type": TYPES[".html"], ...extra });
      return createReadStream(join(ROOT, "404.html")).pipe(res);
    }
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": url.pathname.startsWith("/_next/static/") ? "public, max-age=31536000, immutable" : "no-cache",
      ...extra,
    });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().then(() => console.log(`Serving out/ at http://localhost:${PORT} (with vercel.json headers)`));
}
