【功能】: Master 规划落盘工具。把规划结果（goal / allowed_skills / acceptance_criteria 等）校验后写入当前项目的 task_contract.json（路径由系统注入，无需也不能自行指定）。写入后契约状态置为 planned，等待用户在界面确认后交接 Sub 执行。每轮规划完成时必须调用本技能，否则计划不会生效。
【调用方式】: 必须严格以 JSON 字符串形式传入参数，禁止使用单引号。示例: python skills/planner/write_task_contract.py "{\"goal\": \"生成 2026 年 4 月 Manus 声量趋势折线图并分析 3 个高点\", \"allowed_skills\": [\"es_agg_search\", \"es_sample_search\", \"render_line_chart\"], \"acceptance_criteria\": [\"折线图含峰值标注\", \"每个高点有抽样归因\"], \"input_context\": {\"reference_docs\": [\"line_chart_analysis\"]}}"
【参数说明】 (以 JSON 字符串形式传入):
  - goal (必需): 任务目标，非空字符串。写清楚要交付什么。
  - allowed_skills (必需): 字符串数组。Sub 执行本任务允许调用的技能 id 清单，必须是 registry 中已启用的 role=sub 可执行技能（可附带 doc 型说明书 id）。本技能会逐项校验，含无效 id 时整体拒绝写入。
  - acceptance_criteria (必需): 字符串数组。Master 验收时逐条比对的标准。
  - input_context: 可选 JSON 对象。执行所需的上下文（如 report_type、时间范围、reference_docs 引用的 B 类说明书 id）。
  - output_schema: 可选 JSON 对象。要求 Sub 返回结果的结构约定。
  - task_id: 可选。不传则沿用现有契约的 task_id 或自动生成。
【返回格式】: JSON。成功: {"ok": true, "data": {"contract_file", "contract"}}；失败: {"ok": false, "error", "hint"}。写入成功后请告知用户「规划已写入任务契约，请在左侧计划卡片或任务看板确认后交给 Sub 执行」，不要声称已自动启动 Sub。
