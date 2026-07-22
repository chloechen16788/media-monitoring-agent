# 问题台账（暂时搁置）

## ISSUE-20260609-01 前端 Skills 点击崩溃

- 状态：`resolved`
- 优先级：`P1`（阻断部分技能入口交互，但不阻断后端 M2 路径改造）
- 发现时间：`2026-06-09`
- 影响模块：`frontend/src/components/ChatArea.tsx`

## 现象与业务影响

- 在会话页点击 Skills 菜单项（Slash 菜单或 Skills 下拉）后，前端抛出异常并中断交互。
- 用户无法完成“选 Skill -> 自动填充输入框 -> 继续发送”链路。
- 会影响后续 Master/Sub 任务流入口体验。

## 运行时证据

- 日志来源：Vite dev server 控制台
- 关键错误：
  - `ReferenceError: textareaRef is not defined`
  - 触发点：`src/components/ChatArea.tsx:319`
  - 相关语句：`textareaRef.current?.focus();`

## 根因判断

- `ChatArea.tsx` 中调用了 `textareaRef.current?.focus()`，但组件内未定义 `textareaRef`。
- 属于前端事件处理阶段的运行时引用错误，不是后端 API 逻辑问题。

## 与开发计划关联

- 关联架构文档：`ARCHITECTURE_V2.md`
- 关联计划文档：`DEVELOPMENT_PLAN_V2.md`
- 关联阶段：
  - `M2`：不阻断后端 project/workspace/memory 改造，可继续推进。
  - `M3`：已在第一轮修复并解除阻断，可继续协作流联调。

## 修复记录（2026-06-09）

1. 在 `ChatArea.tsx` 补齐 `textareaRef` 定义与 `textarea` 绑定。
2. 已复测两条入口：
   - Slash 技能菜单点击
   - Skills 下拉列表点击
3. 验证结果：点击后可正常聚焦输入框且无 `textareaRef is not defined` 异常。

---

## ISSUE-20260609-02 M3 第二阶段本地验收命中旧网关进程

- 状态：`open`
- 优先级：`P1`（不阻断代码实现完成，但阻断本地手工验收取证）
- 发现时间：`2026-06-09`
- 影响模块：运行环境（gateway/frontend 进程）

## 现象与业务影响

- 手工复现后，调试日志文件 `/.cursor/debug-a70e32.log` 持续不存在。
- 本地探测 `GET /api/agents/master/system-prompt` 返回 `404`，与 M3 第二阶段预期不符。
- 导致无法基于手工流量完成 M3 第二阶段前端链路取证（尤其是 Prompt 编辑器链路）。

## 受影响具体场景

1. Prompt 编辑器加载场景
   - 用户切换 `master/sub` 时，前端请求 `GET /api/agents/:role/system-prompt`。
   - 命中旧网关时返回 `404`，表现为编辑器无法正确加载内容。

2. Prompt 编辑器保存场景
   - 用户编辑后点击保存，前端请求 `PUT /api/agents/:role/system-prompt`。
   - 命中旧网关时可能直接失败或提示异常，无法确认“保存成功”链路。

3. next_chat 生效验证场景
   - 保存后立即发起新聊天，预期命中新 prompt。
   - 命中旧进程时无法验证 `M3` 第二阶段的核心能力，易误判为功能未生效。

4. 联调取证场景
   - 调试日志长期为空或仅出现自动化测试流量。
   - 无法用手工流量完成前端到后端的完整验收证据闭环。

## 运行时证据

- 网关探针返回：`GET http://127.0.0.1:3000/api/agents/master/system-prompt?userId=1001 -> 404`
- 已有日志记录仅来自集成测试进程，表现为：
  - `origin` 为空
  - `hasMozillaUA` 为 `false`

## 根因判断

- 当前浏览器/手工操作命中的并非最新 M3 第二阶段 gateway 进程。
- 运行环境存在多组历史 dev 进程，导致请求路由到旧服务版本。

## 与开发计划关联

- 关联架构文档：`ARCHITECTURE_V2.md`
- 关联计划文档：`DEVELOPMENT_PLAN_V2.md`
- 关联阶段：
  - `M3` 第二阶段：影响 `system-prompt` 在线编辑与“next_chat 生效”的手工验收取证，不影响代码实现与自动化测试通过。

## 建议处理步骤

1. 停止所有历史 gateway/frontend 进程，仅保留一组最新进程。
2. 先确认 `GET /api/agents/master/system-prompt` 非 `404`。
3. 再执行手工链路：Prompt 编辑器保存 -> 发起新聊天 -> 读取 debug 日志。
