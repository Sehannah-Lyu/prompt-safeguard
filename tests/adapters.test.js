const assert = require("node:assert/strict");
const Adapters = require("../adapters.js");
const Sites = require("../site-manager.js");

const cases = [
  ["https://chatgpt.com/c/chat-123", "chatgpt", "chat-123"],
  ["https://claude.ai/chat/claude-123", "claude", "claude-123"],
  ["https://www.doubao.com/chat/doubao-123", "doubao", "doubao-123"],
  ["https://gemini.google.com/app/gemini-123", "gemini", "gemini-123"],
  ["https://chat.deepseek.com/a/chat/s/deepseek-123", "deepseek", "deepseek-123"],
  ["https://example-chatbot.test/conversation/42", "generic", "/conversation/42"]
];

for (const [url, adapterId, conversationId] of cases) {
  const adapter = Adapters.resolve(url);
  assert.equal(adapter.id, adapterId);
  assert.equal(adapter.conversationId(new URL(url)), conversationId);
  assert.match(Adapters.scope(adapter, url), new RegExp(`^${adapterId}:`));
}

assert.equal(Sites.canEnable("https://example.com/chat"), true);
assert.equal(Sites.canEnable("edge://extensions"), false);
assert.equal(Sites.originPattern("https://claude.ai/chat/123"), "https://claude.ai/*");
assert.equal(Sites.originPattern("http://127.0.0.1:8765/chat"), "http://127.0.0.1/*");
assert.equal(Sites.registrationId("https://claude.ai/chat/1"), Sites.registrationId("https://claude.ai/chat/2"));
assert.notEqual(Sites.registrationId("https://claude.ai"), Sites.registrationId("https://chatgpt.com"));
assert.notEqual(
  Adapters.scope(Adapters.resolve("https://chatgpt.com/c/one"), "https://chatgpt.com/c/one"),
  Adapters.scope(Adapters.resolve("https://chatgpt.com/c/two"), "https://chatgpt.com/c/two")
);
assert.notEqual(
  Adapters.scope(Adapters.resolve("https://chatgpt.com/c/one"), "https://chatgpt.com/c/one"),
  Adapters.scope(Adapters.resolve("https://claude.ai/chat/one"), "https://claude.ai/chat/one")
);
assert.deepEqual(Sites.siteLabel("https://gemini.google.com/app/1", Adapters), {
  adapterId: "gemini",
  label: "Gemini",
  hostname: "gemini.google.com",
  exact: true,
  builtIn: true
});
assert.equal(Sites.siteLabel("https://example-chatbot.test/chat", Adapters).builtIn, false);

const hiddenEditor = {
  nodeType: 1, tagName: "TEXTAREA", type: "", isConnected: true,
  closest: () => null, getAttribute: () => "",
  getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, bottom: 0 })
};
const visibleEditor = {
  nodeType: 1, tagName: "TEXTAREA", type: "", isConnected: true,
  closest: () => null,
  getAttribute: (name) => name === "placeholder" ? "输入消息" : "",
  getBoundingClientRect: () => ({ width: 640, height: 64, top: 700, bottom: 764 })
};
const fakeDocument = {
  querySelectorAll(selector) {
    return selector.includes("textarea") ? [hiddenEditor, visibleEditor] : [];
  }
};
assert.equal(
  Adapters.findEditor(Adapters.resolve("https://www.doubao.com/chat/"), fakeDocument),
  visibleEditor,
  "should ignore a hidden hydration editor and select the visible composer"
);

console.log("Prompt Safeguard adapter tests passed");
