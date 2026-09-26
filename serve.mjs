#!/usr/bin/env node
/**
 * Run Syllify on localhost.
 *
 *   node serve.mjs          → http://localhost:8080
 *   node serve.mjs 3000     → http://localhost:3000
 *
 * No dependencies, no build, no internet. Everything the page needs is in this
 * folder, so this works with the wifi off.
 *
 * You can also just double-click index.html — but browsers restrict workers on
 * file:// URLs, so PDF reading is slower there. Use this server for PDFs.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.argv[2]) || 8080;
const ROOT = new URL(".", import.meta.url).pathname;

const TYPES = {
  ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
  ".mjs":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8",
  ".json":"application/json", ".woff2":"font/woff2", ".txt":"text/plain; charset=utf-8",
  ".md":"text/markdown; charset=utf-8", ".svg":"image/svg+xml", ".ics":"text/calendar",
};

createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/" || p.endsWith("/")) p += "index.html";
  const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end("no"); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-cache",
    }).end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found: " + p);
  }
}).listen(PORT, () => {
  console.log("\n  Syllify → http://localhost:" + PORT + "\n  Ctrl-C to stop.\n");
});
