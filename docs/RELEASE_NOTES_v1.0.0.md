# AiPin v1.0

AiPin 的首个正式版本已经完成。它把一个统一输入窗与多个独立 AI 会话窗放进同一个 Windows 工作区，让一次提问能够并排呈现不同模型的流式回答。

## 主要能力

- 最多 17 个模型窗与 1 个输入窗，自动布局与自由比例调整。
- OpenAI、DeepSeek、Kimi、MiniMax、GLM、MiMo、硅基流动及自定义兼容端点。
- 流式正文与推理过程、单窗停止、批次队列和严格隔离的模型上下文。
- Markdown、代码、LaTeX、AsciiMath、Unicode 数学与安全 MathML 规范化显示。
- 图片输入、提示词注入、输入历史、会话归档与恢复。
- 独立设置窗口、主题实时联动、透明度、字体、间距和双圆角。
- 配置、会话数据或完整数据的 `.aipin` 独立导入导出。

## 下载与启动

下载附件中的 `AiPin.exe` 后直接运行，无需安装。支持 Windows 10 22H2 与 Windows 11 x64，并依赖 Microsoft Edge WebView2 Evergreen Runtime。

设置、数据库和附件保存在 `%LOCALAPPDATA%\AiPin`。直接替换旧 EXE 会继续使用原数据；`v1.0.0` 保持 schema v1 与 `.aipin` schemaVersion 1。

## 隐私与安全

API Key 保存在 Windows Credential Manager。会话和附件保存在本机，请求由电脑直接发送给你选择的供应商，没有 AiPin 中转服务器，也没有默认遥测。`.aipin` 导出文件不包含 API Key。

## 请留意

- 当前只支持 Windows 10/11 x64。
- EXE 尚未进行 Authenticode 签名，Windows 可能显示 SmartScreen 提示。
- 会话数据库和附件没有额外应用级加密，请结合 Windows 用户权限与 BitLocker 使用。
- 不同供应商的模型能力、计费、地区和限流策略仍以各自最新文档为准。
