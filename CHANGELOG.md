# 更新记录

本项目遵循语义化版本。`1.x` 是当前稳定版本线；涉及本地数据格式的变更会提供明确的迁移和兼容策略。

## [1.0.0] - 2026-09-03

### 正式发布

- 将完整多模型工作区、独立模型上下文、流式输出、队列、历史和数据迁移能力封版为首个正式版本。
- 统一应用、前端、Rust、Tauri、关于页和公开文档版本为 `1.0.0`。
- 完成真实 `AiPin.exe` 多模型请求、双窗口联动、公开媒体和 Release 产物验证。
- 提供 Windows CI、严格 Clippy、前端/Rust 测试、依赖更新与安全报告流程。
- 发布中文 README、完整技术架构文档和可直接交给编程 Agent 的二次开发提示词。

### 兼容与限制

- 支持 Windows 10 22H2 / Windows 11 x64，需要 Microsoft Edge WebView2 Evergreen Runtime。
- 当前 EXE 未进行 Authenticode 签名，Windows 可能显示 SmartScreen 提示。
- 保持 schema v1 与 `.aipin` schemaVersion 1，不要求现有用户迁移数据。

## [0.1.0-alpha.1] - 2026-09-03

### 新增

- 一个输入窗同时向多个模型发送，工作区最多容纳 17 个模型窗。
- OpenAI、DeepSeek、Kimi、MiniMax、GLM、MiMo、硅基流动和自定义兼容端点。
- SSE 流式正文与推理内容、单窗停止、批次队列和独立上下文。
- Markdown、代码、KaTeX、AsciiMath、Unicode 数学和安全 MathML 规范化。
- PNG、JPEG、WebP 图片输入、校验、哈希去重与预览。
- 自动布局、窗格拖动、分割调整、锁定和输入窗三态。
- 独立设置窗口、实时主题同步、透明度、字体、间距和双圆角。
- 会话历史、提示词注入和最近输入调取。
- 配置、会话或完整数据的 `.aipin` 导入导出。
- Windows Credential Manager、SQLite WAL、托盘、单实例和紧急可见度恢复。

### 已知限制

- 仅支持 Windows 10 22H2 / Windows 11 x64。
- 需要 Microsoft Edge WebView2 Evergreen Runtime。
- 当前 EXE 未签名，可能触发 SmartScreen。
- DeepSeek 已完成真实端到端验证；其他供应商仍需要各自账号覆盖特有错误和限流行为。
