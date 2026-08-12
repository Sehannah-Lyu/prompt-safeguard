# Prompt Safeguard

本地优先的浏览器扩展：在 AI 聊天页面自动保护长 Prompt，并沉淀为可复用模板。

## Why

长 Prompt 在刷新、误关页面或站点重渲染后容易丢失。Prompt Safeguard 将这一真实使用痛点拆成两层：

- **即时保护**：每 5 秒自动保存草稿，意外返回时一键恢复；
- **长期复用**：保留版本历史，将高频 Prompt 整理为可搜索、可插入的模板。
- 以自身高频工作流中的内容丢失问题为起点，快速完成“问题发现 → 原型 → 跨站调试 → 回归测试”的闭环；
- 用“精确适配 + 通用检测 + 手动选框”平衡跨站兼容性与维护成本；
- 数据仅保存在浏览器本地，不将 Prompt 上传到服务端。

## Features

- 草稿自动保存与恢复
- 版本历史（按站点与对话隔离）
- Prompt 模板库、搜索与变量填充
- ChatGPT、豆包、Gemini、Claude、DeepSeek 精确适配
- 其他聊天网站的通用检测与手动选框兜底

## Install

1. 下载或克隆本仓库。
2. 打开 `edge://extensions` 或 `chrome://extensions`，开启开发人员模式。
3. 点击“加载解压缩的扩展”，选择本项目目录。
4. 重新加载扩展后刷新聊天页面。

## Verify

```powershell
node --check content.js
node tests\core.test.js
node tests\adapters.test.js
node tests\manifest.test.js
node tests\content-layout.test.js
node tests\exact-adapter-contract.test.js
```

## Privacy

草稿、历史和模板只存储在 `chrome.storage.local`；项目不依赖后端，也不上传 Prompt 内容。

## License

[MIT](LICENSE)
