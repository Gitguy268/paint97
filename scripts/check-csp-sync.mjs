#!/usr/bin/env node
// Asserts that vercel.json's Content-Security-Policy matches the policy the
// build actually ships (the <meta> CSP in dist/index.html, plus the
// frame-ancestors directive that only an HTTP header may carry).
// Run after `npm run build` — CI does this in the checks job.
import fs from "node:fs";

const failures = [];
const DIST_HTML = "dist/index.html";

if (!fs.existsSync(DIST_HTML)) {
  console.error("dist/index.html not found — run `npm run build` first.");
  process.exit(1);
}

const html = fs.readFileSync(DIST_HTML, "utf8");
const metaMatch = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html);
if (!metaMatch) {
  console.error("No <meta> CSP found in dist/index.html — cspMeta() plugin missing?");
  process.exit(1);
}
const metaCsp = metaMatch[1];
// Build-time meta strips frame-ancestors (ignored in <meta>); headers keep it.
const expectedHeaderCsp = metaCsp.replace(
  "object-src 'none'; ",
  "object-src 'none'; frame-ancestors 'none'; ",
);

const vercel = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
const headerList = vercel.headers?.[0]?.headers ?? [];
const byKey = Object.fromEntries(headerList.map((h) => [h.key, h.value]));

if (byKey["Content-Security-Policy"] !== expectedHeaderCsp) {
  failures.push(
    "vercel.json CSP differs from the built policy.\n" +
      `  built:  ${expectedHeaderCsp}\n` +
      `  vercel: ${byKey["Content-Security-Policy"] ?? "(missing)"}`,
  );
}

const required = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "X-Permitted-Cross-Domain-Policies": "none",
  "Cross-Origin-Resource-Policy": "same-origin",
};
for (const [key, value] of Object.entries(required)) {
  if (byKey[key] !== value) {
    failures.push(`vercel.json missing or wrong header ${key}: expected "${value}", got "${byKey[key] ?? "(missing)"}"`);
  }
}
if (!byKey["Permissions-Policy"]) failures.push("vercel.json missing Permissions-Policy");

if (failures.length) {
  console.error("CSP/header sync check FAILED:");
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("CSP/header sync OK — vercel.json matches the built policy.");
