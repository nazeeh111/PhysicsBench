import { constants } from "node:fs";
import { lstat, mkdir, open, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Deliberately explicit: tests, scripts and local task material never ship.
const ASSETS = [
  "index.html",
  "styles.css",
  "app.js",
  "bench.js",
  "sweep.js",
  "audio.js",
  "audio-dsp.js",
  "measure.js",
  "analysis.js",
  "models.js",
  "data.js",
  "mark.svg",
  "LICENSE",
];
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, "dist");

async function readRegular(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error(`Expected a regular file: ${path}`);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await file.stat()).isFile())
      throw new Error(`Expected a regular file: ${path}`);
    return await file.readFile();
  } finally {
    await file.close();
  }
}

function localReference(reference, source) {
  // Root-relative paths would break when hosted under a GitHub Pages subpath.
  if (!reference.startsWith("./") || !ASSETS.includes(reference.slice(2))) {
    throw new Error(
      `${source} references an asset outside the allowlist: ${reference}`,
    );
  }
}

function validateHTML(html) {
  const clean = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const match of clean.matchAll(/<([a-z][\w:-]*)\b([^>]*)>/gi)) {
    const tag = match[1].toLowerCase();
    if (tag === "base")
      throw new Error("index.html must not change its base URL.");
    const attributes = new Map();
    for (const attr of match[2].matchAll(
      /([^\s=/'">]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,
    )) {
      const key = attr[1].toLowerCase();
      if (attributes.has(key))
        throw new Error(`index.html has a duplicate ${key} attribute.`);
      attributes.set(key, attr[2] ?? attr[3] ?? attr[4] ?? "");
      if (/^on[a-z]+$/.test(key) || key === "style")
        throw new Error("Inline scripts and styles are unsupported.");
      if (["srcset", "poster", "data", "action", "formaction"].includes(key)) {
        throw new Error(
          `index.html uses an unsupported resource attribute: ${key}`,
        );
      }
    }
    if (
      tag === "script" &&
      (!attributes.has("src") || attributes.get("type") !== "module")
    ) {
      throw new Error("Scripts must be external ES modules.");
    }
    for (const attribute of ["src", "href"]) {
      if (!attributes.has(attribute)) continue;
      const reference = attributes.get(attribute);
      if (tag === "a" && attribute === "href") {
        if (/^#[A-Za-z][\w:-]*$/.test(reference)) continue;
        if (reference.startsWith("https://")) {
          const url = new URL(reference);
          if (url.username || url.password)
            throw new Error("Reference links must not contain credentials.");
          continue;
        }
      }
      localReference(reference, "index.html");
    }
  }
}

function validateModules(sources) {
  const modules = Object.fromEntries(
    [...sources]
      .filter(([name]) => name.endsWith(".js"))
      .map(([name, bytes]) => [name, bytes.toString("utf8")]),
  );
  for (const [name, source] of Object.entries(modules)) {
    // Static imports keep the production graph auditable. This conservative
    // check also rejects that syntax in comments; no dynamic loader is needed.
    if (/\bimport(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))*\(/.test(source)) {
      throw new Error(
        `${name}: dynamic imports are unsupported; use static imports.`,
      );
    }
  }
  // Node's own parser reads imports and re-exports without running browser code.
  // SourceTextModule requires this flag on supported Node 22+ releases.
  const parser = `
    import { readFileSync } from 'node:fs';
    import { SourceTextModule } from 'node:vm';
    const sources = JSON.parse(readFileSync(0, 'utf8'));
    const imports = Object.fromEntries(Object.entries(sources).map(([name, source]) =>
      [name, new SourceTextModule(source, { identifier: name }).dependencySpecifiers]));
    process.stdout.write(JSON.stringify(imports));
  `;
  const imports = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--experimental-vm-modules",
        "--no-warnings",
        "--input-type=module",
        "-e",
        parser,
      ],
      {
        input: JSON.stringify(modules),
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      },
    ),
  );
  for (const [source, references] of Object.entries(imports)) {
    for (const reference of references) {
      localReference(reference, source);
      if (!reference.endsWith(".js"))
        throw new Error(`${source} imports a non-JavaScript asset.`);
    }
  }
}

function validateCSS(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (/@import\b/i.test(clean))
    throw new Error("CSS imports are unsupported; keep styles in styles.css.");
  for (const match of clean.matchAll(
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/gi,
  )) {
    localReference(match[1] ?? match[2] ?? match[3], "styles.css");
  }
}

async function prepareDist() {
  let info;
  try {
    info = await lstat(DIST);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await mkdir(DIST);
    info = await lstat(DIST);
  }
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Refusing a dist path that is not a regular directory.");
  const expected = new Set([...ASSETS, "manifest.json"]);
  for (const name of await readdir(DIST)) {
    if (!expected.has(name))
      throw new Error(
        `Refusing to overwrite dist containing an unexpected entry: ${name}`,
      );
    const file = await lstat(join(DIST, name));
    if (!file.isFile() || file.isSymbolicLink())
      throw new Error(`Refusing a non-regular dist entry: ${name}`);
  }
}

async function writeRegular(name, content) {
  const file = await open(
    join(DIST, name),
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_TRUNC |
      constants.O_NOFOLLOW,
    0o644,
  );
  try {
    await file.writeFile(content);
  } finally {
    await file.close();
  }
}

async function build() {
  const sources = new Map();
  for (const name of ASSETS)
    sources.set(name, await readRegular(join(ROOT, name)));
  validateHTML(sources.get("index.html").toString("utf8"));
  validateModules(sources);
  validateCSS(sources.get("styles.css").toString("utf8"));
  const manifest = {
    format: "physicsbench-dist",
    version: 1,
    files: ASSETS.map((path) => ({
      path,
      bytes: sources.get(path).length,
      sha256: createHash("sha256").update(sources.get(path)).digest("hex"),
    })),
  };
  // Validate every input and existing destination before writing anything.
  await prepareDist();
  for (const [name, content] of sources) await writeRegular(name, content);
  // Writing the manifest last makes incomplete builds fail preview validation.
  await writeRegular("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  console.log(
    `Built ${ASSETS.length} assets in dist/ with deterministic SHA-256 manifest.`,
  );
}

try {
  await build();
} catch (error) {
  console.error(`Build failed: ${error.message}`);
  process.exitCode = 1;
}
