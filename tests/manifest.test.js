const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../manifest.json"), "utf8"));
const contentScript = fs.readFileSync(path.resolve(__dirname, "../content.js"), "utf8");
const expected = [
  "https://chatgpt.com/*",
  "https://gemini.google.com/*",
  "https://www.doubao.com/*",
  "https://claude.ai/*",
  "https://chat.deepseek.com/*"
];

assert.equal(manifest.version, "3.2.0");
assert.equal(manifest.content_scripts.length, 1);
for (const pattern of expected) {
  assert.ok(manifest.host_permissions.includes(pattern), `missing required permission: ${pattern}`);
  assert.ok(manifest.content_scripts[0].matches.includes(pattern), `missing static injection: ${pattern}`);
}
assert.deepEqual(manifest.content_scripts[0].js, ["core.js", "adapters.js", "content.js"]);
assert.ok(manifest.optional_host_permissions.includes("https://*/*"));
assert.doesNotMatch(contentScript, /\bcurrentScope\s*\(/, "content script must not call an undefined scope helper");
assert.match(contentScript, /const nextScope = contextPath\(\)/);
assert.match(contentScript, /await migrateAndPruneHistories\(\)/, "history migration must run before editor scanning");
assert.match(contentScript, /Core\.selectRecentConversations/, "content script must enforce the global conversation limit");
assert.doesNotMatch(contentScript, /\bfetch\s*\(/, "local grouping must not upload Prompt content");

console.log("Prompt Safeguard manifest tests passed");
