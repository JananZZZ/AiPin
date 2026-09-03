# 公开媒体重现说明

`docs/assets/` 中的截图和 GIF 必须从真实 `AiPin.exe` 采集。不要用 Vite 浏览器预览替代桌面程序，也不要把真实会话、API Key、通知或其他软件窗口录入素材。

## 前置条件

1. 在项目目录完成 Release 构建：`./scripts/build-release.ps1`。
2. 本机 AiPin 中至少有一个可调用模型，API Key 已保存到 Windows Credential Manager。
3. 临时 FFmpeg 只安装到 `.tooling/media-tools/`；该目录已被 Git 忽略。
4. 采集前确认当前没有未完成请求，并关闭可能遮挡窗口的通知。

## 启动真实 EXE

以下调试参数只用于本机媒体自动化。调试端口绑定到 loopback，采集结束后应退出这次 AiPin 进程。

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
Start-Process -FilePath (Resolve-Path "release/AiPin.exe")
```

确认 CDP 目标的 URL 为 `http://tauri.localhost/` 后运行：

```powershell
node scripts/docs/inspect-aipin.mjs
node scripts/docs/capture-aipin-media.mjs
./scripts/docs/encode-aipin-media.ps1
```

采集脚本只接受真实 Tauri 主窗口，工作流程如下：

- 将原应用快照临时写入 `.tooling/docs-media-app-snapshot.json`。
- 保留模型配置与 Credential Manager 引用，但清空演示期间可见的原消息。
- 使用固定的无隐私问题生成公开对话素材。
- 截取主窗、独立设置窗、布局和历史等真实界面。
- 无论成功或失败，都在 `finally` 中恢复原快照并删除临时备份。

编码后的公开文件位于 `docs/assets/`，原始 PNG 帧位于被忽略的 `output/docs-media/`。

## 发布前人工检查

- 逐张检查静态截图。
- 为每个 GIF 抽取开头、中间和结尾关键帧检查。
- 确认没有完整 Key、真实私密问题、用户名、绝对路径或桌面内容。
- 确认单个 GIF 小于约 6 MiB，总体积不超过约 25 MiB。
- 对 Git 候选文本和最终 EXE 再执行一次密钥特征扫描。
