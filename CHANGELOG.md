# 更新记录

本项目遵循语义化版本。当前仍处于 alpha 阶段，界面和本地数据结构可能在提供迁移的前提下继续调整。

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
