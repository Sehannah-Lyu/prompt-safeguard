const assert = require("node:assert/strict");
const Adapters = require("../adapters.js");

const exactSites = [
  ["ChatGPT", "https://chatgpt.com/", "chatgpt"],
  ["豆包", "https://www.doubao.com/chat/", "doubao"],
  ["Gemini", "https://gemini.google.com/app", "gemini"],
  ["Claude", "https://claude.ai/new", "claude"],
  ["DeepSeek", "https://chat.deepseek.com/", "deepseek"]
];

for (const [name, url, id] of exactSites) {
  const adapter = Adapters.resolve(url);
  assert.equal(adapter.id, id, `${name} should resolve to its exact adapter`);
  assert.ok(adapter.editorSelectors.length, `${name} needs editor selectors`);
  assert.ok(adapter.composerSelectors.length, `${name} needs composer selectors`);
  assert.ok(adapter.sendSelectors.length, `${name} needs send selectors`);
  assert.ok(adapter.hosts.some((host) => new URL(url).hostname === host || new URL(url).hostname.endsWith(`.${host}`)), `${name} host should be covered`);
}

assert.equal(new Set(exactSites.map(([, , id]) => id)).size, exactSites.length, "exact adapters must remain independent");
console.log("Prompt Safeguard exact-site adapter contract tests passed");
