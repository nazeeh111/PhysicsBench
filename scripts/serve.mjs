import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Keep in sync with the explicit build allowlist. The manifest is not served.
const TYPES = new Map([
  ["index.html", "text/html; charset=utf-8"],
  ["styles.css", "text/css; charset=utf-8"],
  ["app.js", "text/javascript; charset=utf-8"],
  ["bench.js", "text/javascript; charset=utf-8"],
  ["sweep.js", "text/javascript; charset=utf-8"],
  ["audio.js", "text/javascript; charset=utf-8"],
  ["audio-dsp.js", "text/javascript; charset=utf-8"],
  ["measure.js", "text/javascript; charset=utf-8"],
  ["analysis.js", "text/javascript; charset=utf-8"],
  ["models.js", "text/javascript; charset=utf-8"],
  ["data.js", "text/javascript; charset=utf-8"],
  ["mark.svg", "image/svg+xml"],
  ["LICENSE", "text/plain; charset=utf-8"],
]);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function parsePort(args) {
  if (args.length === 0) return 4173;
  if (
    args.length !== 2 ||
    args[0] !== "--port" ||
    !/^[1-9]\d{0,4}$/.test(args[1])
  ) {
    throw new Error("Usage: node scripts/serve.mjs [--port 1–65535]");
  }
  const port = Number(args[1]);
  if (port > 65535) throw new Error("Port must be from 1 to 65535.");
  return port;
}

async function readRegular(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error(`Expected a regular built file: ${path}`);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await file.stat()).isFile())
      throw new Error(`Expected a regular built file: ${path}`);
    return await file.readFile();
  } finally {
    await file.close();
  }
}

export async function loadAssets(directory = join(ROOT, "dist")) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error(
      "dist must be a regular directory. Run npm run build first.",
    );
  const names = await readdir(directory);
  if (
    names.length !== TYPES.size + 1 ||
    names.some((name) => !TYPES.has(name) && name !== "manifest.json")
  ) {
    throw new Error(
      "dist has missing or unexpected files. Run npm run build first.",
    );
  }
  const manifest = JSON.parse(
    (await readRegular(join(directory, "manifest.json"))).toString("utf8"),
  );
  if (
    manifest?.format !== "physicsbench-dist" ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== TYPES.size
  ) {
    throw new Error("Unsupported or incomplete build manifest.");
  }
  const records = new Map();
  for (const record of manifest.files) {
    if (
      !record ||
      !TYPES.has(record.path) ||
      records.has(record.path) ||
      !Number.isSafeInteger(record.bytes) ||
      record.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(record.sha256)
    ) {
      throw new Error("Invalid build manifest entry.");
    }
    records.set(record.path, record);
  }
  const assets = new Map();
  for (const [name, type] of TYPES) {
    const bytes = await readRegular(join(directory, name));
    const record = records.get(name);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== record.bytes || sha256 !== record.sha256)
      throw new Error(
        `Built file differs from its manifest: ${name}. Run npm run build again.`,
      );
    assets.set(name, { bytes, type });
  }
  return assets;
}

// Assets are verified and read once at startup. Requests never access disk.
export function createHandler(assets) {
  return (request, response) => {
    const headers = {
      "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    };
    function send(status, bytes, type, extra = {}) {
      response.writeHead(status, {
        ...headers,
        "Content-Type": type,
        "Content-Length": bytes.length,
        ...extra,
      });
      response.end(request.method === "HEAD" ? undefined : bytes);
    }
    function error(status, message, extra) {
      send(
        status,
        Buffer.from(`${message}\n`),
        "text/plain; charset=utf-8",
        extra,
      );
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      error(405, "Method not allowed", { Allow: "GET, HEAD" });
      return;
    }
    const target = request.url ?? "";
    if (target.length > 2048) {
      error(414, "Request target too long");
      return;
    }
    if (!target.startsWith("/") || target.includes("#")) {
      error(400, "Invalid request target");
      return;
    }
    // Do not normalize or decode: traversal and encoded alternative paths are
    // never names in this allowlist, even if a URL parser would collapse them.
    const pathname = target.split("?", 1)[0];
    const name = pathname === "/" ? "index.html" : pathname.slice(1);
    const asset = TYPES.has(name) ? assets.get(name) : undefined;
    if (!asset) {
      error(404, "Not found");
      return;
    }
    send(200, asset.bytes, asset.type);
  };
}

async function main() {
  const port = parsePort(process.argv.slice(2));
  const assets = await loadAssets();
  const server = createServer(createHandler(assets));
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.on("error", (error) => {
    console.error(`Preview failed: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`PhysicsBench preview: http://127.0.0.1:${port}`);
    console.log(
      "Serving the verified build. Rebuild and restart to preview source changes.",
    );
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await main();
  } catch (error) {
    console.error(`Preview failed: ${error.message}`);
    process.exitCode = 1;
  }
}
