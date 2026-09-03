# AiPin Design System

## Intent

AiPin 的视觉基线是附图 A：近纯黑、高密度、等距、极细边框的多窗格工具。场景是深夜桌面上持续工作的专业用户；界面像一块安静的黑色仪表面板，只有当前输入、输出与关键状态获得注意力。

## Foundations

### Color strategy

使用 restrained 策略。默认根画布为 `oklch(0.05 0 0)`，窗格为 `oklch(0.105 0.006 220)`，悬停表面为 `oklch(0.135 0.008 220)`，主边框为 `oklch(0.29 0.012 220)`，分割线为 `oklch(0.23 0.008 220)`。主文字为 `oklch(0.96 0 0)`，次级文字为 `oklch(0.78 0.01 220)`，弱化文字为 `oklch(0.61 0.01 220)`。暖绯红 `oklch(0.62 0.22 28)` 只用于发送、焦点、危险动作和关键状态。

供应商色只用于 8 DIP 身份圆点：OpenAI 绿、DeepSeek 亮蓝、Kimi 深蓝、MiniMax 红、GLM 紫、MiMo 橙；不得染整段回答。

### Typography

UI 使用 `"Segoe UI Variable", "Segoe UI", system-ui, sans-serif`；代码使用 `"Cascadia Mono", Consolas, monospace`。默认 UI 与正文均为 14px，正文行高 1.48，代码 12.5px。UI 与正文字号均允许 5–30px，并以 0.5px 步进；正文行高与消息间距独立连续调节。

### Geometry

间距刻度为 4/8/12/16/20/24/32 DIP。窗格间距 4 DIP，边框 1 DIP，默认主窗圆角 8 DIP、内窗格 6 DIP；两者均可在 0–30 DIP 内独立调节。标题区 48–52 DIP，正文水平内边距 16 DIP。按钮命中区至少 32 DIP；纯图标按钮悬停使用大圆角矩形表面，不使用彩色外圈，并提供快速浮动提示。

## Components

- `AppShell`：无标题栏主窗口，隐藏控制轨、工作区和管理模式。
- `PaneGrid`：最多 6×3，完整容纳 17 个 AI 窗与一个输入窗。
- `ConversationPane`：供应商身份、局部请求状态、全宽消息段、独立滚动状态。
- `ComposerPane`：紧凑/正常/扩展三态，附件、目标集合、FIFO 队列和发送。
- `EmptyPane`：完整细边框、一个加号与“添加模型”。
- `ManagementView`：独立无边框设置窗口，宽屏左导航、窄屏顶部分类；外观调整实时同步到工作窗口。
- `ControlRail`：按需出现的全局历史、布局、置顶、锁定、设置与窗口控制。

## Interaction

常规状态变化使用 160–220ms ease-out；不动画字体、连续宽高或大面积阴影。拖动时只显示细线合法/非法预览，结束后持久化。所有动效必须有 `prefers-reduced-motion` 降级。低频操作只在悬停或键盘聚焦时浮现，但不能形成 hover-only 功能。

## Responsive and Density

窗格按实际尺寸进入 normal、compact、micro 三档，并用不同进入/退出阈值避免抖动。管理模式在 760 DIP 以下折叠导航。所有文本允许截断或内部滚动，但窗格外框不得被裁掉、重叠或越界。

## Prohibitions

禁止聊天气泡、渐变、玻璃、发光、宽阴影、胶囊窗格、嵌套卡片网格、表情符号图标、装饰性动效与远程字体。禁止依赖颜色单独表达状态。
