import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './MessageRenderer.module.css';

interface MessageRendererProps {
  content: string;
  onShowCitation: (text: string) => void;
  onOpenWorkspace?: (config: any) => void;
  onLockInput?: (isLocked: boolean) => void;
  sessionId: string;
}

export default function MessageRenderer({ content, onShowCitation, onOpenWorkspace, sessionId }: MessageRendererProps) {
  const blockRegex = /<(think|tool_call|tool_result)>([\s\S]*?)<\/\1>/g;
  const workspaceRegex = /\[WORKSPACE_SCHEMA_START\]([\s\S]*?)\[WORKSPACE_SCHEMA_END\]/g;
  
  let processedContent = content;
  const workspaceMatches = [];
  let wMatch;
  while ((wMatch = workspaceRegex.exec(content)) !== null) {
    workspaceMatches.push(wMatch[1]);
  }
  
  // Remove workspace tags from rendered markdown
  processedContent = processedContent.replace(workspaceRegex, '');

  const [cardState, setCardState] = React.useState({ step: 1, isGenerating: false, progress: 0, finished: false });

  // Multi-level Categories State
  const [categories, setCategories] = React.useState([
    {
      id: 'cat_1',
      name: '品牌',
      tasks: [{ id: 't_bmw', name: '宝马 (本品)' }],
      dimensions: [
        { id: 'd_sov', name: '声量与SOV对比' }, 
        { id: 'd_channel', name: '分渠道结构对比' }, 
        { id: 'd_trend', name: '声量趋势对比' },
        { id: 'd_sentiment', name: '情感与负面雷达' },
        { id: 'source_topn', name: '核心声量阵地与KOL榜单' }
      ]
    },
    {
      id: 'cat_2',
      name: '竞品 (对标分析)',
      tasks: [{ id: 't_benz', name: '奔驰 (竞品)' }, { id: 't_audi', name: '奥迪 (竞品)' }],
      dimensions: [
        { id: 'd_sov', name: '声量与SOV对比' },
        { id: 'trend_by_channel', name: '各渠道时序趋势交锋' },
        { id: 'prn_distribution', name: '主动发稿与转载结构比' },
        { id: 'effect_metrics', name: '预估触达阅读效果分析' }
      ]
    }
  ]);
  const [dateRange, setDateRange] = React.useState('1w');

  const availableTasks = [
    { id: 't_bmw', name: '宝马 (本品)' }, { id: 't_benz', name: '奔驰 (竞品)' }, { id: 't_audi', name: '奥迪 (竞品)' }, { id: 't_mini', name: 'MINI (子品牌)' }
  ];
  const availableDimensions = [
    { id: 'd_sov', name: '声量与SOV对比' }, 
    { id: 'd_trend', name: '声量趋势对比' }, 
    { id: 'd_channel', name: '分渠道结构对比' }, 
    { id: 'd_sentiment', name: '情感与负面雷达' },
    { id: 'trend_by_channel', name: '各渠道时序趋势交锋' },
    { id: 'prn_distribution', name: '主动发稿与转载结构比' },
    { id: 'source_topn', name: '核心声量阵地与KOL榜单' },
    { id: 'sentiment_cluster_topn', name: 'AI 负面危机靶向预警' },
    { id: 'effect_metrics', name: '预估触达阅读效果分析' }
  ];

  const handleAddTask = (catId: string, e: React.ChangeEvent<HTMLSelectElement>) => {
    const taskId = e.target.value;
    if (!taskId) return;
    const task = availableTasks.find(t => t.id === taskId);
    if (!task) return;

    setCategories(prev => prev.map(cat => {
      if (cat.id === catId && !cat.tasks.find(t => t.id === taskId)) {
        return { ...cat, tasks: [...cat.tasks, task] };
      }
      return cat;
    }));
    e.target.value = ""; // Reset select
  };

  const handleAddDimension = (catId: string, e: React.ChangeEvent<HTMLSelectElement>) => {
    const dimId = e.target.value;
    if (!dimId) return;
    const dim = availableDimensions.find(d => d.id === dimId);
    if (!dim) return;

    setCategories(prev => prev.map(cat => {
      if (cat.id === catId && !cat.dimensions.find(d => d.id === dimId)) {
        return { ...cat, dimensions: [...cat.dimensions, dim] };
      }
      return cat;
    }));
    e.target.value = ""; // Reset select
  };

  const removeTask = (catId: string, taskId: string) => {
    setCategories(prev => prev.map(cat => 
      cat.id === catId ? { ...cat, tasks: cat.tasks.filter(t => t.id !== taskId) } : cat
    ));
  };

  const removeDimension = (catId: string, dimId: string) => {
    setCategories(prev => prev.map(cat => 
      cat.id === catId ? { ...cat, dimensions: cat.dimensions.filter(d => d.id !== dimId) } : cat
    ));
  };

  const addCategory = () => {
    setCategories(prev => [...prev, {
      id: `cat_${Date.now()}`,
      name: '自定义分类',
      tasks: [],
      dimensions: []
    }]);
  };

  const handleGenerate = async () => {
    setCardState(prev => ({ ...prev, isGenerating: true, progress: 10 }));
    
    try {
      // 模拟一点进度条，提升体验
      const progressInterval = setInterval(() => {
        setCardState(prev => ({ ...prev, progress: Math.min(prev.progress + 15, 80) }));
      }, 500);

      // 解析日期范围
      let start_time = "2026-04-01 00:00:00";
      let end_time = "2026-04-30 23:59:59";
      // 简单 Mock 时间，如果是真实情况可以根据 dateRange 计算
      if (dateRange === '1w') {
        start_time = "2026-04-24 00:00:00";
      }

      const payload = {
        uid: "134209751",
        partition: "202604",
        date_range: [start_time, end_time],
        categories: categories
      };

      const response = await fetch('http://localhost:3000/api/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      clearInterval(progressInterval);

      if (!response.ok) {
        throw new Error('Failed to generate report');
      }

      const result = await response.json();
      setCardState(prev => ({ ...prev, progress: 100 }));
      
      setTimeout(async () => {
        setCardState(prev => ({ ...prev, isGenerating: false, step: 3, finished: true }));
        // 将真实数据传递给 RightSidebar
        onOpenWorkspace?.({ reportType: 'multi_category', data: categories, dateRange, esData: result });
        
        // 隐式将生成的报告上下文注入到底层大模型记忆中
        try {
          const contextMsg = `[系统通知] 用户刚刚成功在右侧大屏生成了一份多维度分析报告。
【报告配置】: 数据周期为 ${dateRange === '1w' ? '最近一周 (2026-04-24至2026-04-30)' : dateRange}。分析对象为 ${categories.map(c => c.name).join('、')}。
【底层引擎配置】: UID为 "${payload.uid}", Partition为 "${payload.partition}"。

【⚠️ 高阶操作指令 ⚠️】
当用户要求“解读数据”、“分析波峰”、“查看详细数据”时，你**必须**使用 shell 工具调用底层的 Python 脚本获取真实数据。
1. 首先使用 shell 工具执行 ["cat", "skills/catalog.json"] 查看可用技能。你只能使用这里面列出的技能（如 es_agg_search 或 es_sample_search），绝不要捏造其他脚本！
2. 了解技能用法：执行 ["python", "skills/get_skill_doc.py", "es_agg_search"]。
3. 执行技能获取数据，调用时务必在 JSON 参数中携带 "uid" 和 "partition"。例如执行 ["python", "skills/es_agg_search.py", "{\\"task_ids\\": [6860], \\"uid\\": \\"${payload.uid}\\", \\"partition\\": \\"${payload.partition}\\", \\"dimensions\\": [\\"trend\\"]}"]。
4. **致命红线**：shell 工具的 command 参数**必须且只能**是字符串数组 (Array of strings)！绝对不能传入纯字符串！

【✨ 大屏动态注入指令 (Generative UI) ✨】
当用户要求“把分析结果加到报告里”或“更新大屏趋势图的解读”时，你可以直接通过魔法指令远程重写右侧图表下方的文字！
- 右侧大屏可被更新的图表 ID 对应关系为：趋势图叫 'd_trend'，渠道图叫 'd_channel'，各渠道时序交锋图叫 'trend_by_channel'。
- 你必须在对话回复的末尾输出以下代码块来实现内容覆盖：
<UPDATE_INSIGHT target="图表ID">
这里写你要更新到右侧大屏的深度洞察内容...
</UPDATE_INSIGHT>
这部分代码会被系统拦截并直接投射到大屏，用户能看到打字机效果！`;
          
          await fetch(`http://localhost:3000/api/sessions/${sessionId}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: [
                {
                  role: 'user',
                  content: contextMsg
                },
                {
                  role: 'assistant',
                  content: '[隐藏回复] 收到，我已经了解了最新生成的报告配置上下文。我将在后续回答中参考这些数据。'
                }
              ]
            })
          });
        } catch(e) {
          console.error("Failed to inject context", e);
        }
      }, 500);

    } catch (e) {
      console.error(e);
      alert('生成报告失败，请检查后端服务是否启动。');
      setCardState(prev => ({ ...prev, isGenerating: false }));
    }
  };

  const renderInlineCard = () => {
    if (workspaceMatches.length === 0) return null;
    
    return (
      <div className={styles.inlineCard}>
        <div className={styles.cardHeader}>
          <div><i className="ri-settings-4-fill"></i> 高级报告配置</div>
          <div className={styles.dateSelector}>
            <i className="ri-calendar-line"></i>
            <select value={dateRange} onChange={e => setDateRange(e.target.value)}>
              <option value="1w">最近一周</option>
              <option value="1m">最近一个月</option>
              <option value="3m">最近一季度</option>
              <option value="1y">最近一年</option>
              <option value="custom">自定义范围...</option>
            </select>
          </div>
        </div>
        
        {cardState.step === 1 && !cardState.isGenerating && (
          <div className={styles.cardBody}>
            {categories.map((cat, idx) => (
              <div key={cat.id} className={styles.categoryBlock}>
                <div className={styles.categoryHeader}>
                  <i className="ri-folder-2-fill"></i> 
                  <input 
                    type="text" 
                    value={cat.name} 
                    onChange={e => {
                      const newName = e.target.value;
                      setCategories(prev => prev.map(c => c.id === cat.id ? {...c, name: newName} : c));
                    }}
                    className={styles.categoryTitleInput} 
                  />
                  {idx > 0 && (
                    <i className={`ri-delete-bin-line ${styles.deleteCatBtn}`} onClick={() => {
                      setCategories(prev => prev.filter(c => c.id !== cat.id));
                    }}></i>
                  )}
                </div>

                <div className={styles.tagSection}>
                  <div className={styles.tagLabel}>分析任务：</div>
                  <div className={styles.pillContainer}>
                    {cat.tasks.map(t => (
                      <span key={t.id} className={styles.pillTag}>
                        {t.name} <i className="ri-close-line" onClick={() => removeTask(cat.id, t.id)}></i>
                      </span>
                    ))}
                    <select className={styles.addSelect} onChange={(e) => handleAddTask(cat.id, e)} defaultValue="">
                      <option value="" disabled>+ 添加任务</option>
                      {availableTasks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                </div>

                <div className={styles.tagSection}>
                  <div className={styles.tagLabel}>图表维度：</div>
                  <div className={styles.pillContainer}>
                    {cat.dimensions.map(d => (
                      <span key={d.id} className={`${styles.pillTag} ${styles.dimTag}`}>
                        <i className="ri-bar-chart-fill"></i> {d.name} <i className="ri-close-line" onClick={() => removeDimension(cat.id, d.id)}></i>
                      </span>
                    ))}
                    <select className={styles.addSelect} onChange={(e) => handleAddDimension(cat.id, e)} defaultValue="">
                      <option value="" disabled>+ 添加维度</option>
                      {availableDimensions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            ))}

            <button className={styles.addCategoryBtn} onClick={addCategory}>
              <i className="ri-add-circle-line"></i> 添加分析对象分类
            </button>

            <div className={styles.cardFooter}>
              <button className={styles.cancelBtn} onClick={() => setCardState(p => ({...p, finished: true}))}>取消</button>
              <button className={styles.confirmBtn} onClick={handleGenerate}>开始生成大盘报告</button>
            </div>
          </div>
        )}

        {cardState.isGenerating && (
          <div className={styles.cardBody}>
            <p style={{textAlign: 'center', marginBottom: 12}}>正在执行多层级并发数据引擎...</p>
            <div className={styles.progressBar}><div className={styles.progressFill} style={{width: `${cardState.progress}%`}}></div></div>
          </div>
        )}

        {cardState.finished && cardState.step === 3 && (
          <div 
            className={`${styles.cardBody} ${styles.finishedCardBody}`} 
            style={{textAlign: 'center', color: '#52c41a'}}
            onClick={() => onOpenWorkspace?.({ reportType: 'multi_category', data: categories })}
          >
            <i className="ri-checkbox-circle-fill" style={{fontSize: 24}}></i> 报告已生成，点击此处可随时重新查看报告画布。
          </div>
        )}
      </div>
    );
  };

  const blocks = [];
  let lastIndex = 0;
  let match;

  while ((match = blockRegex.exec(processedContent)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({ type: 'markdown', content: processedContent.slice(lastIndex, match.index) });
    }
    blocks.push({ type: match[1], content: match[2] });
    lastIndex = match.index + match[0].length;
  }
  
  if (lastIndex < processedContent.length) {
    const remaining = processedContent.slice(lastIndex);
    const unclosedMatch = remaining.match(/<(think|tool_call|tool_result)>/);
    if (unclosedMatch) {
      const parts = remaining.split(`\x3C${unclosedMatch[1]}\x3E`);
      if (parts[0]) blocks.push({ type: 'markdown', content: parts[0] });
      blocks.push({ type: unclosedMatch[1], content: parts[1] || '', isStreaming: true });
    } else {
      blocks.push({ type: 'markdown', content: remaining });
    }
  }

  const handleCitationClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'SUP' || target.classList.contains('citation')) {
      const toolResultRegex = /<tool_result>([\s\S]*?)<\/tool_result>/g;
      let toolResultsContext = '';
      let trMatch;
      while ((trMatch = toolResultRegex.exec(content)) !== null) {
        let rawText = trMatch[1].replace(/```(json)?/g, '').trim();
        try {
          const parsed = JSON.parse(rawText);
          if (parsed.output) {
            toolResultsContext += parsed.output + '\n\n---\n\n';
          } else {
            toolResultsContext += rawText + '\n\n---\n\n';
          }
        } catch (e) {
          toolResultsContext += rawText + '\n\n---\n\n';
        }
      }
      
      const text = toolResultsContext.trim() 
        ? `**溯源上下文:**\n\n${toolResultsContext}` 
        : `未找到关联的知识库原文。`;
      onShowCitation(text);
    }
  };

  const renderMarkdown = (text: string) => {
    const processed = text.replace(/\[(\d+)\]/g, '[$1](#citation-$1)');
    
    return (
      <div onClick={handleCitationClick}>
        <ReactMarkdown 
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({node, ...props}) => {
              if (props.href?.startsWith('#citation-')) {
                const id = props.href.replace('#citation-', '');
                return <sup className="citation" data-id={id}>[{id}]</sup>;
              }
              if (props.href?.startsWith('./workspace/')) {
                const filename = props.href.split('/').pop();
                return (
                  <a 
                    href={`http://localhost:3000/api/sessions/${sessionId}/download/${filename}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className={styles.fileDownloadLink}
                  >
                    <i className="ri-file-download-line"></i> 下载 {filename}
                  </a>
                );
              }
              return <a {...props} />;
            }
          }}
        >
          {processed}
        </ReactMarkdown>
      </div>
    );
  };

  return (
    <div className={styles.renderer}>
      {blocks.map((block, i) => {
        if (block.type === 'think' || block.type === 'tool_call' || block.type === 'tool_result') {
          let icon = "ri-brain-line";
          let title = "思考过程";
          if (block.type === 'tool_call') {
            icon = "ri-tools-line";
            title = "工具调用";
          } else if (block.type === 'tool_result') {
            icon = "ri-code-box-line";
            title = "执行结果";
          }
          
          if (block.isStreaming) {
            title = "正在" + title.replace("过程", "");
          }
          
          return (
            <details key={i} className={styles.thinkBlock} open={block.isStreaming}>
              <summary>
                <i className={icon}></i> 
                {title}
              </summary>
              <div className={styles.thinkContent}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.content}</ReactMarkdown>
              </div>
            </details>
          );
        }
        
        if (block.type === 'markdown') {
          return <div key={i} className={styles.markdownBlock}>{renderMarkdown(block.content)}</div>;
        }
        
        return null;
      })}
      
      {renderInlineCard()}
    </div>
  );
}
