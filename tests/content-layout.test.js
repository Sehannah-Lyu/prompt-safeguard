const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "content.css"), "utf8");

// The extension must never become a sibling in a chatbot's composer. Many
// modern chat composers are Flex/Grid containers, so a sibling can consume a
// layout row and make the native editor look empty or unclickable.
assert.match(content, /function mountAboveComposer\(element\)[\s\S]*document\.body\.appendChild\(element\)/);
assert.doesNotMatch(content, /insertBefore\(element, anchor\)/);
assert.match(content, /function positionComposerDock\(\)/);
assert.match(content, /Dock in the empty upper-right area of the composer/);
assert.match(content, /\(rect\.right \|\| window\.innerWidth\) - dockWidth - gutter/);
assert.match(content, /window\.addEventListener\("resize", scheduleDockPosition/);
assert.match(content, /window\.addEventListener\("scroll", scheduleDockPosition/);
assert.match(css, /\.ps-vault-trigger\s*\{\s*position:\s*fixed;/);
assert.match(css, /\.ps-restore-bar\s*\{\s*position:\s*fixed;/);
assert.match(css, /\.ps-trigger-status\s*\{\s*min-width:\s*0;/);

console.log("Prompt Safeguard composer-layout regression tests passed");
