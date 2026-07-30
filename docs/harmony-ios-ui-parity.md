# Codex Relay iOS -> HarmonyOS UI 对照基线

> 目的：这是鸿蒙 ArkTS 端还原 iOS UI 的唯一长期事实源。每次继续开发、构建或模拟器验收前，必须先阅读本文件；完成任何界面或交互后，必须回写实现范围、验证结果和截图/布局记录。
>
> 原则：iOS 源码是视觉与交互的权威来源，不能把“ArkTS 能构建”当作 UI 还原完成。每一页都要检查状态栏、底部导航区、空态、加载态、错误态、触感反馈、动画和可访问性。

## 0. 使用契约与当前总览

### 交接规则

1. 本文件是唯一的 UI 还原上下文；不得仅依赖聊天记录、记忆或“看起来差不多”的印象继续开发。
2. 实现前先定位本文件对应章节，再读取表中列出的 iOS 权威源码；iOS 有变化时先更新“源码索引”和行为描述。
3. “已实现”与“已验收”分开记录：前者只能说明代码存在，后者必须有本轮鸿蒙模拟器的截图或布局记录。
4. 本地演示数据、格式校验和真实 Relay 协议是三件不同的事。没有真实服务端证据时，严禁标记为“真实 Relay 已验证”。
5. 模拟器不能可靠验证振动、多指缩放、读屏朗读和部分系统权限；这些项目必须明确标为“待真机”，不能因代码调用成功而勾选。

### 验收标记

| 标记 | 含义 | 可作为完成依据 |
| --- | --- | --- |
| `[x]` | 已在当前鸿蒙模拟器实际操作并记录证据 | 截图路径或布局 JSON |
| `[~]` | 已实现或局部验证，仍缺关键状态/设备条件 | 代码位置加待补项 |
| `[ ]` | 尚未实现或未验证 | 不得宣称完成 |
| 待真机 | 模拟器无法证明的系统能力 | 真机录屏、日志或人工验收 |
| 待 Relay | 依赖真实本地服务协议/数据的能力 | 服务端联调记录 |

### 当前完成矩阵（2026-07-29）

| 区域 | 本地 UI/交互 | 模拟器沉浸式验收 | 真实 Relay | 真机专属验收 | 下一步关键缺口 |
| --- | --- | --- | --- | --- | --- |
| 聊天与输入框 | `[~]` 本地消息、停止、附件、模型/权限 | `[x]` 聊天页无白边、键盘避让 | 待 Relay | 触感、读屏 | 流式消息、失败重试、长文本 |
| 侧边抽屉 | `[~]` 搜索、新建、归档、切换 | `[x]` 覆盖状态栏与导航区 | 待 Relay | 读屏、长列表性能 | 项目切换、加载/错误状态 |
| 消息协议与任务 | `[~]` 活动、审批、差异、计划 | `[~]` 关键本地状态已有截图 | 待 Relay | 触感 | 多条协议状态、真实数据 |
| 工作区与编辑器 | `[~]` Git/Files/Web/终端本地状态、编辑保存 | `[x]` 工作区系统栏图标和底部指示器可见 | 待 Relay | 触感 | 五类标签真实数据、保存失败 |
| 图片查看器 | `[~]` 本地资源、单指手势、重置 | `[~]` 既有页面截图；本轮未重入复测 | 待 Relay | 双指缩放 | 真实附件、下载/失败回调 |
| 配对与设置 | `[~]` 深链格式校验、真实版本探测、本地设置、移除确认 | `[x]` 配对/设置无白边 | `[~]` 已验证公开版本接口 | 振动、权限 | 安全握手、候选服务、推送 |

### 固定模拟器回归顺序

每次涉及全局布局、系统栏、抽屉、弹层或导航的改动，按以下顺序运行，任何一页异常都不得结束本轮：

1. 冷启动聊天页：检查时间/电量区与底部导航区没有白边，输入框不压住导航指示条。
2. 打开和关闭抽屉：检查背景铺满系统栏，内容避开状态图标，遮罩与系统返回都能关闭。
3. 打开设置和工作区：检查白色系统状态图标、透明系统栏和底部导航指示器仍正确。
4. 进入配对、文件编辑和图片查看：检查二级页返回、全屏背景和顶部控件避让。
5. 涉及输入或弹层时：打开软键盘、模型/权限面板、确认弹窗，检查外侧关闭、系统返回和底部安全区。
6. 将通过、失败和无法验证的项目分别回写到第 13 节；不要用旧截图替代本轮失败或未测状态。

## 1. 范围与源码索引

| iOS 路由/区域 | 权威源码 | 鸿蒙入口 | 当前状态 |
| --- | --- | --- | --- |
| 会话主界面 | `apps/mobile/src/components/chat/ChatShell.tsx`、`ChatScreen.tsx` | `apps/hm_codex/entry/src/main/ets/pages/Index.ets` | 本地交互已具备，真实流待接 |
| 顶部栏 | `ChatShellHeader.tsx` | `Index.ets: Header` | 本地导航、全屏系统栏已验收 |
| 侧边抽屉 | `ThreadDrawerContent.tsx`、`ThreadList.tsx` | `Index.ets: Drawer` | 本地搜索/会话/归档已验收，需补项目与真实状态 |
| 消息与任务流 | `MessageTimeline.tsx`、`MessageBubble.tsx`、`ProtocolActivityCard.tsx`、`PlanProgressBanner.tsx` | `Index.ets: MessageRow/ActivityCard` | 本地协议卡与计划已实现，真实流待接 |
| 输入框与模型控制 | `ChatComposer.tsx`、`ChatControls.tsx`、`ChatModelPickerSheet.tsx`、`RuntimeModeSheet.tsx` | `Index.ets: Composer/ModelSelectorSheet/PermissionSelectorSheet` | 本地输入、附件和选择器已验收 |
| 工作区预览 | `WorkspacePreviewSurface.tsx`、`workspace-preview/*` | `Index.ets: WorkspacePage` | 本地五类标签骨架与交互已具备，真实数据待接 |
| 文件编辑 | `app/workspace-file-editor.tsx` | `Index.ets: FileEditorPage` | 本地编辑、脏状态、保存/放弃已验收 |
| 图片查看 | `app/image-viewer.tsx` | `Index.ets: ImageViewerPage` | 本地资源与基础手势已验收，真实附件/双指待补 |
| 配对 | `app/pair.tsx`、`ConnectionBanner.tsx` | `Index.ets: PairPage` | 深链格式与公开版本探测已验收，安全握手待接 |
| 设置 | `app/settings.tsx` | `Index.ets: SettingsPage` | 本地设置与移除确认已验收，真实数据待接 |

## 2. 全局视觉与安全区

### iOS 基准

- 深色工作台，文本以白色/灰色层级表达，交互强调色为浅蓝，成功状态为绿色。
- 页面使用安全区；图片查看器例外，顶部栏覆盖图片，但自身按顶部安全区补偿。
- 底部弹层由 `@gorhom/bottom-sheet` 容器统一管理。
- 应尊重系统“减少动态效果”设置，现有开关动画会检测 `useReducedMotion()`。

### 鸿蒙实现要求

- `EntryAbility.ets` 必须调用 `setWindowLayoutFullScreen(true)`。
- 状态栏与导航栏保持透明，令页面或抽屉背景能够延伸到时间、电量和底部横条下方。
- 从 `TYPE_SYSTEM` 和 `TYPE_NAVIGATION_INDICATOR` 读取避让区，写入 `AppStorage`；根内容层按像素转 vp 后添加动态 `padding`。
- 抽屉、遮罩、全屏图片等覆盖层不继承内容层的 `padding`；它们背景全屏，内部控件再独立避让。
- 每次修改沉浸式布局后，至少在聊天页、抽屉页、设置页、工作区页分别截图验收。

### 已验收的鸿蒙行为

- 全屏布局、动态上下避让、透明系统栏已写入 `EntryAbility.ets` 与 `Index.ets`。
- 聊天页、工作区文件页、文件编辑页和侧边抽屉已在鸿蒙模拟器截图检查过无白色安全区。
- 侧边抽屉已改为根级全屏覆盖层；状态栏下方显示抽屉背景，抽屉内容避开时间与电量。
- 2026-07-29：侧边抽屉的状态栏透明覆盖、搜索筛选、软键盘布局已在模拟器验证；截图为 `/tmp/hm-drawer-transparent-bars.jpeg` 与 `/tmp/hm-drawer-search.jpeg`。
- 2026-07-29：抽屉新建会话会插入并选中本地会话；计划任务卡可在聊天时间线展开，截图为 `/tmp/hm-drawer-new-thread.jpeg`、`/tmp/hm-plan-collapsed.jpeg` 与 `/tmp/hm-plan-expanded.jpeg`。
- 2026-07-29：助手消息的标题、列表和围栏代码块已在模拟器验证；截图为 `/tmp/hm-markdown-message.jpeg`。
- 2026-07-29：工作区标签条已改为横向可滚动区域并保留固定添加入口；文件标签可打开编辑器，编辑脏状态和本地保存提示已在模拟器验证。截图为 `/tmp/hm-workspace-tabs-fixed.jpeg`、`/tmp/hm-workspace-files.jpeg`、`/tmp/hm-file-editor-dirty.jpeg` 与 `/tmp/hm-file-editor-saved.jpeg`。
- 2026-07-29：模型与权限选择器改为分别绑定在各自触发器上，避免同一根节点的多个 `bindSheet` 相互覆盖；模拟器已验证弹层打开、选择并回写。截图为 `/tmp/hm-model-sheet-fixed.jpeg`、`/tmp/hm-model-fast-selected.jpeg`、`/tmp/hm-permission-sheet-fixed.jpeg` 与 `/tmp/hm-permission-auto-selected.jpeg`。
- 2026-07-29：抽屉选择会话会同步主界面顶部标题与工作区名称；遮罩、关闭按钮、搜索无结果、搜索清除和键盘避让均已在模拟器验证。截图为 `/tmp/hm-thread-selected.jpeg`、`/tmp/hm-drawer-scrim-close.jpeg`、`/tmp/hm-drawer-button-close.jpeg`、`/tmp/hm-drawer-search-empty.jpeg` 与 `/tmp/hm-drawer-search-cleared.jpeg`。
- 2026-07-29：根 UIContext 使用 `KeyboardAvoidMode.RESIZE`；软键盘出现时聊天列表缩小，输入框的附件、模型、权限和发送控制仍完整可见。页头与输入框中的符号按钮也改为文本点击控件以避免鸿蒙模拟器的符号缺失。截图为 `/tmp/hm-composer-symbols-visible.jpeg`。
- 2026-07-29：聊天时间线绑定 `Scroller`，用户消息、本地回执和停止活动写入后会自动滚到末尾；模拟器已验证发送中、停止生成与“已停止生成”活动卡。截图为 `/tmp/hm-timeline-autoscroll-running.jpeg` 与 `/tmp/hm-timeline-stop-autoscroll.jpeg`。
- 2026-07-29：设置页的 Relay 地址、模型和审批模式改为读取当前本地状态；未连接显示明确空态，返回符号在沉浸式系统栏下可见。截图为 `/tmp/hm-settings-dynamic.jpeg`。
- 2026-07-29：图片查看页的关闭和重置改用可见文本点击控件；全屏顶部操作不与系统状态栏重叠。截图为 `/tmp/hm-image-controls-visible.jpeg`。
- 2026-07-29：图片查看页补充本地资源的加载/就绪状态，以及资源缺失或加载失败时的明确空态。模拟器已复验资源就绪、重置和关闭返回聊天页，截图为 `/tmp/hm-image-loaded-state.jpeg`、`/tmp/hm-image-reset.jpeg`，关闭后的布局记录为 `/tmp/hm-image-close.json`。目前展示资源仍为本地占位图；真实消息附件、网络加载失败回调尚未验收。
- 2026-07-29：聊天页连接横幅已按 iOS 状态层级改为未配对三步引导卡、检查中的紧凑重连卡和“服务器可达但尚未安全配对”的提示卡。扫码入口会跳转到当前可用的深链配对页并明确提示粘贴链接；已重新构建、安装并在鸿蒙模拟器检查沉浸式首屏与跳转。截图为 `/tmp/hm-connection-onboarding-inset-fixed.jpeg` 与 `/tmp/hm-pair-from-banner.jpeg`。该状态不代表已完成真实 Relay 握手或二维码扫描。
- 2026-07-29：设置页已改为可滚动分段界面，覆盖项目、用量空态、已连接电脑、通知偏好、运行时和版本信息；通知开关在模拟器点击后已由布局树验证从 `checked: false` 回写为 `checked: true`。截图为 `/tmp/hm-settings-expanded.jpeg` 与 `/tmp/hm-settings-notification-on.jpeg`；真实推送注册、服务候选切换、用量和热更新数据仍待 Relay 接入。
- 2026-07-29：助手 Markdown 已补充一级标题、引用、编号列表、链接视觉反馈和错误消息卡；模拟器截图已确认编号列表、链接与错误卡，布局树确认相关文本节点。截图为 `/tmp/hm-markdown-expanded-scrolled.jpeg` 与 `/tmp/hm-markdown-error.jpeg`。行内代码分段、高亮、真实剪贴板复制、附件和表格仍待实现。
- 2026-07-29：抽屉会话的归档动作已改为与 iOS 一致的确认流程，遮罩覆盖系统栏；模拟器已验证取消保留会话、确认归档移除当前会话并切换至下一个会话。截图为 `/tmp/hm-archive-confirm.jpeg`，布局记录为 `/tmp/hm-archive-cancel.json` 与 `/tmp/hm-archive-committed.json`。
- 2026-07-29：深链配对的有效输入分支曾仅做本地格式校验；该旧结果不可作为已连接或已配对的依据，后续已被真实版本探测流程替代。
- 2026-07-29：工作区 Git、Web、终端标签已补本地交互状态；模拟器验证 Git 刷新标记、Web 地址打开反馈和终端连接/断开状态。截图为 `/tmp/hm-workspace-interactive.jpeg`、`/tmp/hm-workspace-web-opened.jpeg`、`/tmp/hm-workspace-terminal-connected.jpeg`，布局记录为 `/tmp/hm-workspace-git-refreshed.json`、`/tmp/hm-workspace-web-opened.json`、`/tmp/hm-workspace-terminal-connected.json`。真实 Git/WebView/SSH 数据流仍待 Relay 接入。
- 2026-07-29：文件编辑器的未保存返回保护已按 iOS 行为补齐；模拟器验证“继续编辑”保留脏内容，选择“放弃”回到工作区且丢弃修改。截图为 `/tmp/hm-editor-discard-confirm.jpeg`，布局记录为 `/tmp/hm-editor-keep.json` 与 `/tmp/hm-editor-discarded.json`。
- 2026-07-29：消息复制按钮已接入鸿蒙系统剪贴板，并在模拟器点击后显示成功勾选和“已复制消息内容”反馈；截图为 `/tmp/hm-copy-success.jpeg`，布局记录为 `/tmp/hm-copy-success.json`。HDC 无法读取剪贴板原文，剪贴板内容需在真机/系统测试中补验。
- 2026-07-29：图片附件流程已改为与 iOS 一致的“输入框附件条 -> 发送后的消息缩略图 -> 全屏查看器”，而不是选择图片后直接打开查看器；模拟器已验证附件条、缩略图打开查看器和 Markdown 文档卡跳转工作区。截图为 `/tmp/hm-composer-image-attached.jpeg`、`/tmp/hm-message-attachment-image.jpeg`、`/tmp/hm-markdown-attachment-workspace.jpeg`，布局记录为 `/tmp/hm-composer-image-attached.json`、`/tmp/hm-message-attachment-image.json`、`/tmp/hm-composer-image-sent.json` 与 `/tmp/hm-markdown-attachment-workspace.json`。当前附件使用本地占位资源和本地回执；图库选择、文件上传、缓存下载和真实 Relay 附件字段仍待接入。
- 2026-07-29：已声明 `ohos.permission.VIBRATE`，并将 iOS 的选择、成功、警告三类触感映射到鸿蒙 `vibrator.startVibration`；不支持振动的设备会静默降级。系统返回键已在模拟器验证可关闭抽屉、可从工作区返回聊天页，布局记录为 `/tmp/hm-drawer-before-back.json`、`/tmp/hm-drawer-system-back.json`、`/tmp/hm-workspace-before-back.json` 与 `/tmp/hm-workspace-system-back.json`。物理触感本身必须在具备马达的真机补验。
- 2026-07-29：消息时间线补充独立审批协议卡，不再将待批准操作混入普通助手气泡；本地回执后会显示待批准操作，允许/拒绝动作会更新卡片结果并触发对应成功/警告触感。模拟器已验证待批准和允许后的结果状态，截图为 `/tmp/hm-approval-pending.jpeg`、`/tmp/hm-approval-allowed.jpeg`，布局记录为 `/tmp/hm-approval-pending.json`、`/tmp/hm-approval-allowed.json`。真实 Relay 审批事件、失败回执和多条审批独立状态仍待接入。
- 2026-07-29：审批协议卡已按 iOS `ProtocolActivityCard` 的决策面扩展为取消、拒绝、仅本次会话允许和允许四种本地预览动作；处理后的标题、说明、颜色和触感按决策区分，并使用可换行操作区避免小屏按钮溢出。`hvigor assembleHap` 构建通过；该增量尚未安装到模拟器截图复验，不能计为已验收。
- 2026-07-29：消息时间线补充独立文件变更卡，显示路径、增删统计和可折叠差异片段；展开后会自动滚到时间线底部，避免内容落入输入框下方。模拟器已验证折叠、展开和自动滚动后的三条差异行，截图为 `/tmp/hm-diff-expanded.jpeg`、`/tmp/hm-diff-expanded-autoscroll.jpeg`，布局记录为 `/tmp/hm-diff-collapsed.json`、`/tmp/hm-diff-expanded.json`、`/tmp/hm-diff-expanded-autoscroll.json`。真实 Relay 文件差异、长差异分段和文件打开动作仍待接入。
- 2026-07-29：助手 Markdown 补充轻量行内代码、表格行和围栏代码语言头；模拟器已确认 `setWindowLayoutFullScreen(true)` 行、两列表格、`TS` 代码语言头和沉浸式上下系统栏，截图为 `/tmp/hm-markdown-inline-table.jpeg`，布局记录为 `/tmp/hm-markdown-inline-table.json`。当前仍是轻量解析器，真实语法高亮、复杂嵌套和横向溢出策略待完善。
- 2026-07-29：重新检查当前抽屉的沉浸式首屏，背景持续覆盖时间、电量和底部导航区域，截图为 `/tmp/hm-drawer-current-fullscreen.jpeg`，布局记录为 `/tmp/hm-drawer-current-fullscreen.json`。抽屉图标入口、会话行、归档、新建和设置已加入 ArkUI `accessibilityText`；布局树不回显读屏文本，需在启用 TalkBack/读屏的真机补验。
- 2026-07-29：设置页“移除已识别服务器”改为确认操作，取消会保留本地识别状态；确认后会清除本地配对信息、回到聊天首页并重新显示未配对引导。模拟器确认弹窗截图为 `/tmp/hm-remove-server-confirm.jpeg`，取消与最终提交布局记录为 `/tmp/hm-remove-server-cancel.json`、`/tmp/hm-remove-server-final.json`，最终截图为 `/tmp/hm-remove-server-final.jpeg`。确认层当前由取消按钮和系统返回关闭；外侧遮罩关闭待进一步完善。
- 2026-07-29：沉浸式回归发现工作区右侧系统状态图标会被动态颜色选择器置黑；现将主窗口句柄写入 `AppStorage`，聊天、设置、配对、文件编辑、工作区和图片查看器出现时都会重新应用透明栏和白色系统栏内容。模拟器截图 `/tmp/hm-workspace-system-icons-fixed.jpeg`、`/tmp/hm-systembars-pair.jpeg` 已确认工作区与配对页的时间、网络、电量和底部导航指示器同时可见且无白边。图片查看器已保留此前的验证证据；本轮自动点击因时间线虚拟化未重新进入该页，不重复计数。
- 2026-07-29：抽屉“新建会话”已改为先打开工作区选择底部面板，而非固定写入第一个项目。面板有读取中、空态、错误/重试和当前项目标记；选择 `hm_codex` 后，模拟器确认聊天页标题为“新会话”、工作区为 `hm_codex`，并显示创建成功反馈。截图为 `/tmp/hm-workspace-chooser-close-visible.jpeg`、`/tmp/hm-workspace-chooser-created.jpeg`，系统返回关闭面板的布局记录为 `/tmp/hm-workspace-chooser-back.json`。项目目录目前仍为本地预览数据，真实目录浏览与 Relay 加载失败待接入。
- 2026-07-29：设置页补充了 iOS 更新区对应的本地可观察状态：检查更新、检查完成、更新日志展开与清除日志。模拟器已验证“当前已是最新版本”反馈、三条日志展开及清除后的空态；截图为 `/tmp/hm-settings-update-current.jpeg`、`/tmp/hm-settings-logs-expanded.jpeg`、`/tmp/hm-settings-logs-cleared.jpeg`，布局记录为 `/tmp/hm-settings-update-current.json`、`/tmp/hm-settings-logs-expanded.json`、`/tmp/hm-settings-logs-cleared.json`。这是本地 UI 预览状态机，不代表已接入 Hot Updater 或真实服务端更新检查。
- 2026-07-29：聊天连接横幅和错误卡补充“重新检查连接”操作。模拟器已验证错误状态进入“正在检查本地配对链接”，随后回退到带具体原因的错误状态，同时消息时间线和底部输入框保持可用；截图为 `/tmp/hm-retry-checking.jpeg`、`/tmp/hm-retry-failed.jpeg`，布局记录为 `/tmp/hm-retry-failed.json`。这是本地连接状态机，真实网络重连、超时和服务端错误码仍待 Relay 接入。
- 2026-07-29：图片消息缩略图可在模拟器进入全屏查看器，附件标题会透传为 `界面截图.png`；双击放大和重置均已复验。复验中发现放大图片会覆盖顶部操作栏，已通过显式层级和半透明头部背景修复；修复后关闭、标题和重置按钮持续位于图片上方。截图为 `/tmp/hm-image-viewer-title.jpeg`、`/tmp/hm-image-zoom-header-fixed.jpeg`、`/tmp/hm-image-zoom-reset-fixed.jpeg`，布局记录为 `/tmp/hm-image-viewer-title.json`、`/tmp/hm-image-zoom-reset-fixed.json`。真实附件源、下载失败和双指缩放仍待 Relay/真机验收。
- 2026-07-29：助手 Markdown 的行内代码改为基于 `Text + Span` 的分段渲染，不再把整行正文当作等宽代码。模拟器确认普通中文正文保持常规字形，而 `setWindowLayoutFullScreen(true)` 仅自身为浅蓝等宽片段；标题、引用、列表、表格、链接和围栏代码仍正常显示。截图为 `/tmp/hm-markdown-inline-code-visible.jpeg`，布局记录为 `/tmp/hm-markdown-inline-code-visible.json`。复杂嵌套、粗斜体、真实 Shiki 词法高亮和横向代码滚动仍待完善。
- 2026-07-29：设置页“移除已识别服务器”确认框已补外侧遮罩关闭，并在模拟器复验两条路径：点外侧关闭后仍保留服务器，点击“移除”后回到未配对聊天页。截图为 `/tmp/hm-remove-overlay-open.jpeg`、`/tmp/hm-remove-overlay-committed.jpeg`，布局记录为 `/tmp/hm-remove-overlay-dismissed.json`、`/tmp/hm-remove-overlay-confirm.json`、`/tmp/hm-remove-overlay-committed.json`。
- 2026-07-29：配对页已接入 Relay 公开 `/version` 探测，格式正确的深链不再直接被标为“已连接”。鸿蒙模拟器通过 HDC `rport tcp:8787 tcp:8787` 访问本机 `http://127.0.0.1:8787/version`，收到了真实响应 `codex-relay-server`、版本 `1.4.2`；页面显示“Relay 服务器可达”和“仍需完成加密握手和电脑端批准”，截图为 `/tmp/hm-version-probe-final.jpeg`，布局记录为 `/tmp/hm-version-probe.json`。这只验证公开连通性，不能访问受保护的会话/工作区接口，也绝不等价于安全配对。
- 2026-07-29：消息时间线补齐 iOS `structuredUserInput` 对应的独立协议卡。卡片提供“聊天页/侧边抽屉/工作区”预设答案与自由输入、提交后的绿色答案回显，并把回答作为新的用户消息追加到时间线。模拟器已验证选择“聊天页”后的回写与时间线追加，截图为 `/tmp/hm-structured-input-submitted.jpeg`，布局记录为 `/tmp/hm-structured-input-submitted.json`。当前是本地协议预览；真实请求 ID、答案数组提交、错误重试和服务端回执待 Relay 安全会话接入。
- 2026-07-29：本轮新 HAP 已回归聊天、抽屉、设置、工作区、配对和图片查看器。设置页的本地 Relay 信息、工作区五个标签、图片缩略图进入 `界面截图.png` 全屏查看器均可用；对应记录为 `/tmp/hm-regression-drawer.json`、`/tmp/hm-regression-settings.json`、`/tmp/hm-regression-workspace.json`、`/tmp/hm-version-probe-final.jpeg`、`/tmp/hm-regression-image-viewer.jpeg` 与 `/tmp/hm-regression-image-viewer.json`。状态栏与底部导航指示器在各页保持深色沉浸式背景，无白色安全区回归。
- 2026-07-29：抽屉切换线程不再只修改标题。现在先显示会话加载态，再替换为该线程的本地预览；新建会话显示独立空态，不会继承上一会话的消息。模拟器已验证“看下这个项目”的加载/内容切换与 `hm_codex` 新会话空态，截图为 `/tmp/hm-thread-switch-loading.jpeg`、`/tmp/hm-thread-switch-loaded.jpeg`、`/tmp/hm-thread-new-empty-systembars-fixed.jpeg`，布局记录为 `/tmp/hm-thread-switch-loaded.json`、`/tmp/hm-thread-new-empty.json`。新会话路径曾使状态栏内容变暗，现已在抽屉退出过渡结束后重新应用系统栏配置并复验通过。真实线程列表、消息分页、加载失败和本地持久化待 Relay 接入。
- 2026-07-29：配对检查在访问公开版本接口前，已在鸿蒙模拟器真实生成 X25519 临时密钥对和 32 字节安全随机 `clientNonce`。为兼容复制过程中将参数分隔符编码为 `%26` 的链接，解析器会将其还原为 `&`。通过 HDC 端口转发访问本机 Relay 后，页面正确显示“Relay 服务器可达”及“仍需完成加密握手和电脑端批准”，截图为 `/tmp/hm-crypto-probe-final.jpeg`，布局记录为 `/tmp/hm-crypto-probe-final.json`。此记录只证明设备侧加密基础与公开连通性，绝不表示已创建安全会话。
- 2026-07-29：本轮继续完成纯前端 UI/本地交互项：输入框支持随文本长度动态增高，显示字符数、行数和“下一次请求参数”摘要；模型、权限和计划模式统一回写控制条与设置页，并触发本地反馈。设置页新增服务候选切换和会话状态刷新预览；文件编辑器新增保存中、保存成功和可触发的保存失败状态；Web、终端、文件打开、附件打开和错误重试等点击入口补齐本地触感反馈。`hvigor assembleHap` 构建通过；该增量尚未安装到模拟器逐项截图复验，不能计为已验收。
- 2026-07-29：本轮 HAP 已重新构建、卸载旧包并安装到鸿蒙模拟器，重点复验前端任务合理性。连接横幅在已有消息时改为紧凑状态，避免三步引导挤压时间线；长文本输入框、模型/权限弹层、设置页服务候选与会话刷新、工作区标签保存提示、工作区添加标签底部面板、文件编辑保存失败态、图片查看器、审批四按钮和结构化输入提交均已通过布局树与截图检查。截图/布局记录包括 `/tmp/hm-chat-compact-banner.jpeg`、`/tmp/hm-composer-long-closed.jpeg`、`/tmp/hm-model-sheet-current.jpeg`、`/tmp/hm-permission-sheet-current.jpeg`、`/tmp/hm-settings-current.jpeg`、`/tmp/hm-settings-scrolled-current.jpeg`、`/tmp/hm-workspace-current.jpeg`、`/tmp/hm-workspace-sheet-fixed-current.jpeg`、`/tmp/hm-editor-fail-current.jpeg`、`/tmp/hm-image-viewer-current.jpeg`、`/tmp/hm-approval-four-fixed.jpeg` 与 `/tmp/hm-structured-current.jpeg`。本轮发现并修复工作区 `+` 标签面板无法弹出的问题；真实 Relay、图库、二维码扫描、双指缩放和读屏/物理触感仍按规则保留。

## 3. 会话主界面

### 顶部栏

- 左侧：抽屉入口；中部：当前会话标题和工作区；右侧：工作区预览、更多操作。
- iOS 中图标按下会触发 `hapticSelection()`；禁用按钮不触发。
- 标题必须单行截断，工作区名使用紧凑的次级样式。

### 消息时间线

- 用户消息靠右，支持富文本提示、复制、图片附件；助手消息靠左并按 Markdown 渲染。
- 助手 Markdown 包含标题、列表、引用、行内代码、代码块、链接和表格等富文本规则。
- 代码块使用 Shiki 的 `github-dark-default` 主题，高亮语言包括 TypeScript、ArkTS 同类、JSON、Shell、Python、Markdown 等；长内容有截断上限。
- 图片附件可进入全屏查看器；Markdown 附件可进入工作区 Markdown 标签。
- 工具、状态、推理类消息不是普通气泡，而是协议活动卡或专用时间线项目。
- 复制成功有短暂“已复制”状态，约 1400ms 后恢复，并触发选择触感。

### 任务列表与计划渲染

- `PlanProgressBanner` 在计划出现时以约 160ms 淡入。
- 默认展示“已完成步数 / 总步数”、当前步骤和子代理摘要；点击可展开/收起，触发选择触感。
- 展开后逐条显示 `completed`、`inProgress`、`pending`；运行项使用旋转指示器，子代理区域约 120ms 淡入。
- 任务结束或执行中，时间线底部有 `RunningFooter`，包含脉冲点和旋转状态。
- 实施计划、补充上下文、取消、重试等操作必须有明确可用/禁用状态，不能只显示静态文本。

### 鸿蒙验收清单

- [~] 用户气泡、助手 Markdown、错误、工具/状态、审批、文件差异、计划、结构化用户输入与运行尾部均有独立样式。工具活动卡可展开执行摘要、耗时和文件清单，本地审批卡可取消、拒绝、仅本次会话允许或允许，文件差异卡可展开，结构化输入卡可选预设答案或填写其他答案并提交；本轮审批四按钮和结构化输入已在模拟器复验。推理、真实审批/差异/输入事件和多条独立服务端状态待 Relay 接入。
- [~] 已支持标题、引用、无序/编号列表、基础代码块、行内代码分段、表格、链接视觉反馈、错误卡、系统剪贴板复制，以及本地图片/Markdown 附件的打开入口；真实语法高亮、复杂嵌套、横向滚动和真实 Relay 附件待实现。剪贴板原文需真机/系统测试补验。
- [x] 任务清单展开/收起、进行中旋转、完成标记与步骤计数已实现；计划数据仍待接入真实消息流。
- [~] 发送一条消息后出现用户气泡、发送中状态和助手回执；失败时能重试。当前本地预览已验证线程切换加载、独立消息预览、新会话空态、用户气泡、生成中停止键与模型/权限回执，以及连接失败后的重新检查状态；真实 Relay 流、消息发送失败回执和服务端重试待接入。
- [~] 每个可点击的消息操作在鸿蒙提供轻触反馈或明确的无触感说明。当前复制、附件打开、Markdown 附件跳转、错误重试、审批、差异展开、结构化输入和工作区入口已接入本地触感或成功/警告反馈；物理触感仍待真机验收。

## 4. 输入框、模型与权限

### iOS 基准

- `ChatComposer` 支持多行输入、技能 `$`、文件 `@`、图片/附件、停止生成、发送、上下文占用和运行模式。
- 模型选择使用独立底部弹层；运行模式/高级模型选项也有单独控制面板。
- `FastToggle` 使用约 140ms 的 thumb/track 动画，并尊重减少动态效果设置；切换有选择触感。
- 计划模式、权限模式、推理强度、模型、上下文占用在不同状态下会改变输入框控制条。

### 鸿蒙验收清单

- [~] 模型与权限选择器、计划模式、发送与停止生成已实现打开、选中和回写；控制条新增下一次请求参数摘要，设置页也读取同一组本地状态。本轮已在模拟器复验长文本动态高度、模型/权限弹层和参数摘要回写；本地图片附件的选择、移除、纯图片发送和消息缩略图打开已验证。系统图库选择与真实上传仍待接入。
- [~] 两个选择弹层已有拖拽条、遮罩、复用面板头部、关闭按钮和选中标记；模型和权限弹层的点击外侧关闭已在模拟器验证，布局记录为 `/tmp/hm-model-sheet-outside-open.json`、`/tmp/hm-model-sheet-outside-closed.json`、`/tmp/hm-permission-sheet-outside-open.json`、`/tmp/hm-permission-sheet-outside-closed.json`；本轮复验截图为 `/tmp/hm-model-sheet-current.jpeg` 与 `/tmp/hm-permission-sheet-current.jpeg`。拖拽手感和键盘避让仍需专项验收。
- [~] 模型/权限变更后，输入框控制条、设置页和下一次请求参数一致。当前模型、权限、计划模式和附件数量会统一反映在输入框摘要与设置页；真实请求参数待 Relay 接入后联调。
- [x] 输入框聚焦和软键盘出现时，控制条不遮挡发送按钮或键盘；本轮已复验长文本动态高度、字符数、行数和请求参数摘要，截图 `/tmp/hm-composer-long-closed.jpeg`。
- [~] 控制开关的颜色、禁用状态、动画与触感已在本地 UI 中接入；计划开关、模型和权限选择均有选择反馈，发送禁用态仍按文本/附件/生成状态变化。模拟器逐项截图和物理触感待补。

## 5. 侧边抽屉

### iOS 基准

- 由 Drawer 路由布局和 `ThreadDrawerContent` 提供；打开/关闭需有过渡，抽屉外点击关闭。
- 内容：品牌区、搜索、清除搜索按钮、空搜索态、新建会话、项目分组、会话行、线程操作、GitHub、设置。
- 搜索清除与空态有 Reanimated 样式动画；部分繁重抽屉操作在 `InteractionManager.runAfterInteractions` 后执行，避免动画掉帧。
- 常用动作有 `hapticSelection()`，新建/成功类操作会用 `hapticSuccess()`，删除/警告会用轻触或警告触感。
- 当前会话、运行中会话、普通会话、空项目、加载状态与错误状态都有区分。

### 鸿蒙验收清单

- [x] 抽屉背景从时间、电量一行延伸到底部导航条；右侧遮罩全高且不露出主页面的状态栏区域。
- [x] 抽屉内容从状态栏下方开始，关闭按钮和搜索框不与系统图标重叠。
- [x] 外侧遮罩、关闭按钮与系统返回键关闭抽屉均已在模拟器验证。
- [x] 抽屉动画有进入/离开过渡；列表滚动性能仍待长列表验证。
- [~] 搜索、清空、无结果、新建会话、切换会话、删除、设置入口均有状态变化。搜索筛选、清空、无结果、工作区选择后新建会话、切换会话、归档确认/取消与设置入口已在模拟器验证；当前项目切换及真实 Relay 项目加载/错误待验证。
- [~] 当前会话、运行态、普通项的视觉已明确；关键抽屉操作的 `accessibilityText` 已接入。读屏朗读、焦点顺序和长列表性能待真机/专项验收。

## 6. 工作区预览与文件编辑

### iOS 基准

- `WorkspacePreviewSurface` 是 Git、Files、Markdown、Web、SSH 五类可关闭标签页的容器。
- 标签添加菜单使用 `AppBottomSheet` 和 `SheetActionRow`；标签的打开/关闭、空态和切换使用布局动画，切换会触发选择触感。
- Git 显示分支、改动、刷新/提交操作；Files 支持目录浏览与进入文件编辑器。
- Markdown 显示附件预览；Web 是页面预览；SSH 有连接、终端状态与输入桥接。
- 文件编辑器含返回、文件名/路径、语言/字节数/行数、加载/错误/二进制/过大状态、编辑、脏状态、保存与放弃确认。

### 鸿蒙验收清单

- [~] 五个标签均有真实内容或明确空态，能切换、添加、关闭并保存选择状态。当前标签切换、横向滚动、关闭、全部关闭空态与重新添加已在模拟器验证；Git 本地刷新标记、Web 地址打开反馈与终端连接状态也已验证。本轮补充并复验“标签布局已保存”本地反馈和添加标签面板，截图 `/tmp/hm-workspace-current.jpeg`、`/tmp/hm-workspace-sheet-fixed-current.jpeg`。跨应用重启持久化与真实 Git/Web/SSH 数据待接入。
- [~] 文件列表可进入编辑器，编辑内容后出现脏状态；保存成功/失败有反馈，返回时可放弃或继续编辑。当前文件入口、脏状态、本地保存成功提示与放弃/继续编辑确认已验证；本轮补充并复验保存中、成功回显和输入 `FAIL_SAVE` 触发的本地失败态，截图 `/tmp/hm-editor-fail-current.jpeg`。真实保存失败待 Relay 接入。
- [~] Markdown 至少渲染标题、列表、代码块和链接；聊天中的本地 Markdown 文档卡可打开工作区 Markdown 标签，工作区 Markdown/Web/SSH 均有明确本地状态，不用无说明空白替代。真实文件内容、WebView 和 SSH 数据待 Relay 接入。
- [~] 工作区底部弹层已改用复用 `SheetHeader`/`SheetOption` 原语，包含拖拽条、关闭按钮、选中圆点和关闭无障碍标签；本轮修复并复验 `+` 入口可打开面板。遮罩外侧关闭由 `bindSheet` 提供，拖拽手感待专项验收。

## 7. 图片查看器

### iOS 基准

- 黑色舞台，顶部半透明浮层包含关闭、居中标题、重置。
- 单图 `contain` 显示；双击在 1x 与 2x 间切换。
- 支持双指缩放，范围 1x 到 4x；放大后可拖拽平移。
- 重置动画为 180ms、`Easing.out(cubic)`；接近 1x 时手势结束自动归位。

### 鸿蒙验收清单

- [~] 关闭、重置、双击缩放、双指缩放、放大后拖拽均可用。当前消息缩略图进入查看器、附件标题、关闭、重置、双击缩放和单指拖拽已在模拟器验证；双指缩放待真机验证。
- [~] 缩放范围、归位时机与动画时长接近 iOS。当前范围限制为 1x-4x、双击 1x/2x 切换、接近 1x 自动归位和 180ms 重置已实现；本轮复验图片标题、关闭和重置控件不被系统栏遮挡，截图 `/tmp/hm-image-viewer-current.jpeg`。双指缩放待真机。
- [x] 头部浮层和手势舞台在沉浸式状态下不受状态栏遮挡。
- [~] 加载中、无图片、加载失败的界面已实现；本地资源就绪、重置和关闭已在模拟器验证，本轮再次复验消息缩略图进入查看器和顶部操作栏。真实消息附件、网络加载和失败回调待接入后逐项验收。

## 8. 配对与连接状态

### iOS 基准

- `pair.tsx` 将启动参数转换为 `codex-relay://pair` 链接，再交给聊天屏幕处理。
- `ConnectionBanner` 分别呈现未连接、配对中、已连接、错误/恢复等状态，并带进入、退出与布局动画。
- 设置页可切换服务器候选地址、刷新会话、退出登录、展示计算机名、配额和通知偏好。

### 鸿蒙验收清单

- [~] 配对页展示明确的 `codex-relay://pair` 深链输入与格式校验，不再使用“QR”文字占位；二维码扫描入口待接入系统扫码/图库能力。
- [~] 粘贴、解析失败、探测中、服务器可达、失败、重新探测都有状态和反馈。当前空态、格式错误、真实 `/version` 成功和版本显示已在模拟器验证；安全握手、批准、会话授权和安全重连待接 Relay 协议。
- [x] 连接横幅出现在聊天页标题下、消息列表上；未配对引导、探测中/失败重连和“服务器可达但未配对”三种状态均不遮挡消息。未配对首屏和进入深链配对页已在模拟器验证。二维码扫描、真实安全连接/错误恢复动画仍待接入后验收。
- [~] 设置已显示当前本地识别状态、服务地址、模型、审批模式与本地通知偏好；本轮新增服务候选切换和会话状态刷新预览。设备名、真实握手后的连接状态、真实服务器切换和推送注册待接 Relay 协议。

### 安全配对协议契约

> 权威实现：`apps/mobile/src/lib/codex-relay-api.ts`、`apps/mobile/src/lib/secure-transport.ts`、`packages/codex-relay/src/secure-transport.ts`。鸿蒙端不能以本地开关或公开 `/version` 响应替代任何一步。

1. 解析深链中的候选 `serverUrl` 与 `serverPublicKey`，依次尝试每个候选服务地址。
2. 为每次尝试生成 X25519 临时密钥对与 32 字节随机 `clientNonce`；向 `POST /v1/pair` 发送 `clientSessionId`、`clientName` 和 `secure.clientEphemeralPublicKey/clientNonce/protocolVersion: 1`。
3. 从响应读取 `approvalCode`，向用户展示“等待电脑端批准”；以约 1 秒间隔轮询 `GET /v1/pair/{approvalCode}`，服务端 `202` 表示仍在等待，最长等待 5 分钟。
4. 批准后的安全响应必须用深链携带的 Ed25519 公钥校验 `serverSignature`。签名文本为带固定 `tag: codex-relay-e2ee-v1` 的 JSON transcript，字段与 iOS 顺序完全一致。
5. 以 X25519 共享密钥、`SHA-256(transcript)` 作为 salt，使用 HKDF-SHA256 派生 32 字节 `mobileToServerKey` 和 `serverToMobileKey`。info 格式为 `codex-relay-e2ee-v1|{keyEpoch}|{base64(sha256(transcript))}|{方向}`。
6. 解密批准响应中的 AES-256-GCM 数据。nonce 固定 12 字节：第 0 字节为发送方（mobile=1、server=2），第 4-11 字节为大端 64 位 counter。必须校验方向、`keyEpoch` 与 counter 单调递增，拒绝重放。
7. 仅在签名校验、解密和 `clientToken/clientTokenExpiresAt` 都成功后，才可显示“已连接”并请求受保护的线程、工作区和设置接口；密钥、token、counter 必须安全持久化。

当前鸿蒙 SDK 已确认具备 X25519、Ed25519、HKDF、SHA-256 与 AES-GCM 相关 CryptoFramework 声明；尚未完成互操作实现与端到端验收。

## 9. 设置页

### iOS 基准

- 分段包含项目链接、用量/限额、连接、通知、版本/更新、日志和支持链接。
- 使用 `FadeIn`、`FadeOut`、`LinearTransition` 处理设置项的进入、移除和重排。
- 刷新、切换服务、退出登录、通知授权/取消、清理日志等会触发选择或警告触感，并显示加载与失败状态。

### 鸿蒙验收清单

- [~] Relay 地址、模型、审批模式和本地通知偏好不再为静态假数据，未连接有明确空态；项目、用量空态、连接电脑、服务候选、本地会话刷新、通知、版本以及本地更新检查/日志状态已还原。真实用量、设备名、推送注册、日志和热更新数据待接入。
- [~] 已识别服务器移除已有确认、取消、外侧关闭与成功后的未配对反馈；本地更新检查、日志清理、服务候选切换和会话刷新已有加载/结果反馈。真实服务切换、真实会话刷新、退出、通知注册和热更新错误反馈仍待 Relay 接入。
- [~] 设置页本地更新日志展开、清除、服务候选切换和会话刷新已有可观察状态；本轮复验服务候选与运行时状态同步，截图 `/tmp/hm-settings-current.jpeg`、`/tmp/hm-settings-scrolled-current.jpeg`。更细的段落重排动画仍可继续优化。

## 10. 动画、触感与性能统一规范

| 场景 | iOS 证据 | 鸿蒙要求 |
| --- | --- | --- |
| 顶部栏、抽屉、标签、计划点击 | `hapticSelection()` | 已接入鸿蒙轻触反馈；不支持时静默降级，物理触感待真机验收 |
| 新建/成功操作 | `hapticSuccess()` | 已接入成功触感 + 成功状态，物理触感待真机验收 |
| 危险/失败操作 | `hapticWarning()` | 已接入警告触感 + 明确风险色/确认操作，物理触感待真机验收 |
| 抽屉搜索和空态 | Reanimated 样式动画 | 约 120-180ms，支持减少动态效果 |
| 计划卡 | 淡入 160ms、子项淡入 120ms、运行旋转 | 同等进入/展开/运行反馈 |
| Fast 开关 | 140ms timing | thumb/track 平滑切换，减少动态效果时直接切换 |
| 图片重置 | 180ms cubic out | 同等归位动画 |
| 重任务 | `InteractionManager` 延后 | 抽屉开关和标签切换期间避免阻塞 UI 线程 |

## 11. 每轮工作流程

1. 修改前：在本文件找对应页面，阅读 iOS 源码和“待验收”项。
2. 实现：优先扩展鸿蒙公共原语，不在单页面复制抽屉、弹层、安全区逻辑。
3. 构建：运行 `apps/hm_codex` 的 `assembleHap`。
4. 模拟器：安装 HAP，实际点击受影响入口，截图保存到 `/tmp/hm-<screen>-<case>.jpeg`。
5. 验收：检查状态栏、导航条、键盘、动画首尾帧、列表滚动、空态/错误态和触感。
6. 回写：将本文件对应清单更新为已验收，并记录截图文件名和日期；未完成项必须保留。

## 12. 当前优先级

1. 用真实 Relay 消息流替换当前本地预览，优先补齐消息附件、协议活动、失败重试和任务状态。
2. 为图片查看器接入真实附件源，并逐项验证加载、失败、双指缩放与拖拽边界。
3. 逐页补齐触感、减少动态效果、无障碍标签及系统返回行为，并在鸿蒙模拟器回写证据。
4. 完成工作区五标签、文件保存、图片手势、配对和设置的真实状态。
5. 最后进行一轮全页面鸿蒙模拟器验收，逐项勾选本文件。

## 13. 交互验收剧本

本节是每次鸿蒙构建后的固定手工测试路径。每一条均需记录“通过 / 失败 / 不适用”、HAP 构建时间和截图路径；没有真机触感条件时，只能记为“待真机”，不能记为已验证。

| 区域 | 操作 | 必须观察到的结果 | 触感/动画 | 当前证据 |
| --- | --- | --- | --- | --- |
| 系统栏 | 启动聊天、设置、工作区、抽屉 | 背景连续延至时间、电量和导航指示条下；交互控件不被系统元素遮挡 | 无突兀白边或布局跳动 | 聊天/抽屉已截图；设置、工作区待复测 |
| 抽屉 | 点左上抽屉入口 | 左侧抽屉和右侧遮罩同时完整铺屏；列表内容从状态栏下开始 | 进入约 220ms，退出约 160ms；入口触发选择触感 | 抽屉背景与动画已截图；触感待真机 |
| 抽屉 | 点遮罩、关闭按钮、系统返回 | 都关闭抽屉且主页保持原滚动位置 | 退出过渡；返回不应退出应用 | 2026-07-29：遮罩、关闭按钮和系统返回均已验证；截图 `/tmp/hm-drawer-scrim-close.jpeg`、`/tmp/hm-drawer-button-close.jpeg`，布局记录 `/tmp/hm-drawer-before-back.json`、`/tmp/hm-drawer-system-back.json` |
| 抽屉搜索 | 输入、清空、输入无匹配内容 | 列表筛选；清空按钮出现/消失；无匹配时显示空态；键盘不挡搜索框 | 清空按钮和空态约 120-180ms | 2026-07-29：无结果、清除恢复和键盘避让已验证，截图 `/tmp/hm-drawer-search-empty.jpeg`、`/tmp/hm-drawer-search-cleared.jpeg` |
| 抽屉会话 | 新建、选中、删除会话 | 新建前选择工作区，随后插入并激活；选中后加载对应时间线；删除有确认或可撤销反馈 | 新建成功触感；删除警告触感 | 2026-07-29：工作区选择面板、选择 `hm_codex` 后的新会话标题/工作区回写、关闭图标和系统返回均已验证，截图 `/tmp/hm-workspace-chooser-close-visible.jpeg`、`/tmp/hm-workspace-chooser-created.jpeg`，布局记录 `/tmp/hm-workspace-chooser-back.json`；归档确认、取消与提交已验证，截图 `/tmp/hm-archive-confirm.jpeg`，布局记录 `/tmp/hm-archive-cancel.json`、`/tmp/hm-archive-committed.json`；触感待真机 |
| 消息时间线 | 首次打开、加载中、空会话、向上滚动、点击消息操作 | 先显示加载态，随后内容淡入；空态清晰；键盘拖拽与列表滚动不打架 | 加载进入约 140ms、退出约 120ms、内容揭示约 260ms | 待验证 |
| Markdown | 发送含标题、列表、引用、行内代码、代码块、链接、表格的消息 | 每种节点独立排版；代码块可横向查看、可复制；附件可打开 | 复制成功约 1400ms 后恢复，并有选择触感 | 标题/列表/基础代码块已截图 |
| 协议活动 | 工具调用、审批、文件改动、详情 | 不混同普通聊天气泡；可展开详情；审批后显示成功或错误；完整详情有加载态 | 选择、成功、警告触感分别对应动作结果 | 2026-07-29：工具活动的展开摘要与文件列表、审批卡的允许后结果、文件差异卡的展开和自动滚动均已在模拟器验证；截图 `/tmp/hm-activity-expanded.jpeg`、`/tmp/hm-approval-pending.jpeg`、`/tmp/hm-approval-allowed.jpeg`、`/tmp/hm-diff-expanded-autoscroll.jpeg`。本轮已实现审批取消、拒绝、仅本次会话允许、允许四按钮并构建通过，待模拟器截图；服务端详情和真实协议流待实现 |
| 计划卡 | 点击折叠态、运行态、完成态 | 计数、当前步骤、子代理摘要和三种步骤状态准确；展开后不挤压消息 | 计划进入约 160ms；子项约 120ms；运行项旋转 | 展开/收起截图已有；真实流数据待接 |
| 输入框 | 聚焦、输入多行、唤起键盘、发送、流式生成、停止 | 输入框随键盘上移；按钮始终可点；发送后清空并显示用户消息；生成时发送替换为停止 | 控制变更和发送有明确反馈 | 2026-07-29：模拟器已验证输入、键盘避让、用户气泡、本地生成、停止活动与自动滚动；`KeyboardAvoidMode.RESIZE` 下附件、模型、权限和发送控制可见，截图 `/tmp/hm-composer-input.jpeg`、`/tmp/hm-composer-reply-visible.jpeg`、`/tmp/hm-composer-symbols-visible.jpeg`、`/tmp/hm-timeline-autoscroll-running.jpeg`、`/tmp/hm-timeline-stop-autoscroll.jpeg`。本轮已实现长文本动态高度、字符数/行数和请求参数摘要，构建通过，待模拟器截图；真实 Relay 流待接 |
| 模型与权限 | 点模型/运行模式，选择任一项，点弹层外部 | 底部弹层出现；选中标记回写到控制条和请求参数；外侧点击关闭 | 选择触感；Fast 开关约 140ms | 2026-07-29：模型和权限弹层、选择与控制条回写、点击外侧关闭均已在模拟器验证，截图 `/tmp/hm-model-sheet-fixed.jpeg`、`/tmp/hm-model-fast-selected.jpeg`、`/tmp/hm-permission-sheet-fixed.jpeg`、`/tmp/hm-permission-auto-selected.jpeg`，布局记录 `/tmp/hm-model-sheet-outside-open.json`、`/tmp/hm-model-sheet-outside-closed.json`、`/tmp/hm-permission-sheet-outside-open.json`、`/tmp/hm-permission-sheet-outside-closed.json`；触感、拖拽、键盘避让和请求参数待验证 |
| 工作区 | 切换、添加、关闭 Git/Files/Markdown/Web/SSH 标签 | 当前标签、空态与关闭状态正确持久；添加菜单可操作 | 标签选择触感和布局过渡 | 2026-07-29：切换、关闭、无标签空态、添加面板与恢复 Git 已在模拟器验证，截图 `/tmp/hm-workspace-icons.jpeg`、`/tmp/hm-workspace-close-one.jpeg`、`/tmp/hm-workspace-empty-confirmed.jpeg`、`/tmp/hm-workspace-add-sheet.jpeg`、`/tmp/hm-workspace-tab-restored.jpeg`；持久化和触感待验证 |
| 文件编辑 | 打开文件、编辑、保存、返回 | 显示路径/语言/状态；编辑出现脏状态；返回有放弃确认；成功和失败均有反馈 | 保存操作有加载状态 | 2026-07-29：打开、编辑、脏状态与本地保存成功提示已验证，截图 `/tmp/hm-file-editor-dirty.jpeg`、`/tmp/hm-file-editor-saved.jpeg`；本轮已实现保存中、保存成功回显和 `FAIL_SAVE` 本地失败态，构建通过，待模拟器截图；真实保存失败待 Relay 接入 |
| 图片查看 | 双击、双指缩放、拖拽、重置、关闭 | 1x/2x 切换；范围限制 1x-4x；接近 1x 自动归位；顶部控件不遮挡系统栏 | 重置约 180ms cubic-out | 2026-07-29：全屏舞台、双击缩放、拖拽和重置已在模拟器验证，截图 `/tmp/hm-image-fullscreen.jpeg`、`/tmp/hm-image-double-tap.jpeg`、`/tmp/hm-image-pan.jpeg`、`/tmp/hm-image-reset.jpeg`；HDC 不支持多指注入，双指缩放待真机验证 |
| 配对与设置 | 粘贴配对链接、解析错误、服务探测、切换服务、刷新、退出 | 每种连接状态有明确展示；设置数据来自真实状态；危险操作有确认 | 成功/警告触感和加载/错误反馈 | 2026-07-29：配对空态、非法深链及真实 `/version` 成功已在模拟器验证，截图 `/tmp/hm-pair-empty.jpeg`、`/tmp/hm-pair-invalid.jpeg`、`/tmp/hm-version-probe-final.jpeg`；本轮新增设置页服务候选切换和本地会话刷新状态，构建通过，待模拟器截图；安全握手及真实设置数据待接入。2026-07-30：配对页接入 Scan Kit 默认扫码入口，扫码成功后会自动填入 `codex-relay://pair` 链接并复用安全配对流程；已构建、安装并在模拟器验证入口布局和相机不可用兜底，截图 `/tmp/hm-scan-pair-page.jpeg`。模拟器不支持真实相机扫码，二维码识别和授权弹窗待真机验收 |

## 14. iOS 源码审计补充

- `ChatShell` 使用键盘手势区与粘附式输入框；鸿蒙不得通过固定底部高度模拟键盘，必须以实际键盘避让区驱动输入框和时间线。
- `MessageTimeline` 使用键盘感知列表，支持交互式收键盘、底部附件高度补偿、加载会话与空会话两种独立状态；鸿蒙需分开实现，不可共用一段静态占位文案。
- `ThreadDrawerContent` 对搜索词做标准化匹配，搜索清空按钮带透明度、位移和缩放变化；搜索为空与工作区为空的提示文本不同。会话加载失败必须把错误反馈给用户。
- `ChatShellHeader` 的每个可用图标都有无障碍角色和标签，且按下即触发选择触感；鸿蒙的图标按钮需补齐等价无障碍文本。
- `ProtocolActivityCard` 覆盖计划、工具、文件修改与审批请求；审批提供允许、仅本次会话允许、拒绝、取消等不同决策，错误不能静默吞掉。
- `ChatComposer` 除普通输入外，还含技能提及、文件提及、图片移除、上下文用量、目标编辑、计划决策和输入请求答复等状态；鸿蒙以阶段性实现，但每个尚未接入的入口应隐藏或明确不可用，不能伪装成可工作的按钮。
- 所有底部面板应统一沿用同一套：拖拽把手、可访问返回标签、外侧关闭、选中圆点、键盘避让和安全区底部内边距。鸿蒙端需要先抽出公共原语，再补齐各页面。

- 2026-07-29：安全配对协议核心实现已完成并构建通过。`RelaySecureTransport.ets` 新增 `completeSecurePairing()` 方法，包含：Ed25519 签名校验（`verifyEd25519`）、X25519 共享密钥（`x25519SharedSecret`）、手动 HKDF-SHA256 Extract-then-Expand（`hkdfSha256`/`hmacSha256`）、AES-256-GCM 解密（`aesGcmDecrypt`）。双向加解密方法 `encryptPayload`/`decryptResponsePayload` 亦已实现。`Index.ets` 新增 `pollApproval()` 审批轮询方法（1 秒间隔，最长 5 分钟，202 继续等，非 202 调用 `completeSecurePairing`），`inspectPairingLink()` 已跳过不可靠的 `/version` 探测直接 `POST /v1/pair`。`PairPage` 新增 `connected` 状态绿色成功卡；`SettingsPage` 已连接电脑区域覆盖 `connected` 状态；`ConnectionBanner` 颜色和文案已更新；清空和移除按钮同步重置 `clientToken`。ArkTS 严格模式兼容：`GcmParamsSpec` 正确构造、`mac.doFinal()` 无参调用、`DataBlob` 显式类型、类替代对象字面量和 `Record` 类型。Git 提交 `c28d0c1`。端到端互操作验收仍需模拟器与主机网络连通（HDC rport 转发）及服务端批准。
