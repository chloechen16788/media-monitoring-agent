【说明书】专利授权公开日回写全流程（Google > EPO）

适用目标：上传 Excel/CSV/JSONL，从正文提取专利号，查询“授权公开日”，回写新增列 `授权公开日`。查不到写空字符串。

## 所需 allowed_skills
- `read_tabular_data`
- `extract_patent_numbers`
- `lookup_patent_google`
- `lookup_patent_epo_ops`（可选兜底；若未配置 OPS 凭证可跳过）
- `write_tabular_data`

## 标准执行步骤
1. 读取文件（建议保留 `__row_id` 与 `__source_row_number`）。
2. 对指定正文字段提取专利号，得到每行 `first_patent_number`。
3. 逐条调用 Google 查询授权公开日：
   - 命中则写入 `授权公开日`。
   - 未命中时，尝试 EPO OPS（二级兜底）。
4. 将结果回写到文件新副本，新增/更新列 `授权公开日`。

## 参数建议
- 正文字段：`content`、`正文`、`text`、`body`（按真实数据调整）。
- 回写列名：固定 `授权公开日`（MVP 不写申请公开日）。
- 查不到统一写空字符串 `""`。

## 调用示例（逐条命令，禁止循环/管道）

读取：
python skills/executor/read_tabular_data.py "{\"source_path\":\"./uploads/input.xlsx\",\"file_type\":\"xlsx\",\"sheet_index\":0,\"header_row\":1}"

提取专利号：
python skills/executor/extract_patent_numbers.py "{\"rows\":[{\"__row_id\":1,\"content\":\"文本包含CN117228691B\"}],\"content_fields\":[\"content\"],\"include_countries\":[\"CN\",\"EP\",\"WO\",\"US\"]}"

Google 查询：
python skills/executor/lookup_patent_google.py "{\"patent_number\":\"CN117228691B\"}"

EPO 兜底查询（可选）：
python skills/executor/lookup_patent_epo_ops.py "{\"patent_number\":\"CN117228691B\"}"

回写：
python skills/executor/write_tabular_data.py "{\"source_path\":\"./uploads/input.xlsx\",\"rows\":[{\"__row_id\":1,\"授权公开日\":\"2024-08-06\"}],\"output_path\":\"./uploads/input_enriched.xlsx\",\"update_fields\":[\"授权公开日\"]}"

## 结果判定
- 成功：输出文件存在，且新增列 `授权公开日` 已填充。
- 无命中：对应行 `授权公开日` 为空字符串（不报错）。
- 错误：返回结构化 `{\"ok\": false, \"error\", \"hint\"}`，由模型决定重试或降级。
