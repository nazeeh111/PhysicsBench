import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandler, parsePort } from "./scripts/serve.mjs";
test("preview serves added modules with local-only media policy and rejects arbitrary paths/methods", () => {
  const assets = new Map([
    ["index.html", { bytes: Buffer.from("lab"), type: "text/html" }],
    ["audio.js", { bytes: Buffer.from("export {}"), type: "text/javascript" }],
  ]);
  const handler = createHandler(assets);
  const invoke = (url, method = "GET") => {
    const response = {
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers;
      },
      end(body) {
        this.body = body;
      },
    };
    handler({ url, method }, response);
    return response;
  };
  assert.equal(invoke("/audio.js").status, 200);
  assert.equal(invoke("/").body.toString(), "lab");
  assert.equal(invoke("/", "HEAD").body, undefined);
  assert.equal(invoke("/app.js", "POST").status, 405);
  for (const path of [
    "/../package.json",
    "/%2e%2e/package.json",
    "/README.md",
    "//audio.js",
    "/manifest.json",
  ])
    assert.equal(invoke(path).status, 404);
  assert.match(
    invoke("/").headers["Content-Security-Policy"],
    /media-src 'self' blob:/,
  );
  assert.match(
    invoke("/").headers["Content-Security-Policy"],
    /connect-src 'none'/,
  );
  assert.equal(parsePort([]), 4173);
  assert.equal(parsePort(["--port", "4187"]), 4187);
  assert.throws(() => parsePort(["--port", "70000"]));
});
