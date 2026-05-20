import React from 'react';
import { REPORT_SCHEMAS } from '../config/reportSchemas';
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

export default function MessageRenderer({ content, onShowCitation, onOpenWorkspace, onLockInput, sessionId }: MessageRendererProps) {
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

  const [selectedSchemaKey, setSelectedSchemaKey] = React.useState('brand_monthly');
  const [dateRange, setDateRange] = React.useState('1w');
  
  const availableTasks = [
    { id: 't_bmw', name: '宝马 (本品)' }, { id: 't_benz', name: '奔驰 (竞品)' }, { id: 't_audi', name: '奥迪 (竞品)' }, { id: 't_mini', name: 'MINI (子品牌)' }
  ];

  const schema = REPORT_SCHEMAS[selectedSchemaKey];
  
  // Default entity tasks
  const [entityTasks, setEntityTasks] = React.useState<{ [entityKey: string]: { id: string; name: string }[] }>({
    brand: [{ id: 't_bmw', name: '宝马 (本品)' }],
    competitor: [{ id: 't_benz', name: '奔驰 (竞品)' }, { id: 't_audi', name: '奥迪 (竞品)' }],
    product: [],
    leader: []
  });

  const handleAddTask = (entityKey: string, e: React.ChangeEvent<HTMLSelectElement>) => {
    const taskId = e.target.value;
    if (!taskId) return;
    const task = availableTasks.find(t => t.id === taskId);
    if (!task) return;

    setEntityTasks(prev => {
      const current = prev[entityKey] || [];
      if (!current.find(t => t.id === taskId)) {
        return { ...prev, [entityKey]: [...current, task] };
      }
      return prev;
    });
    e.target.value = ""; 
  };

  const removeTask = (entityKey: string, taskId: string) => {
    setEntityTasks(prev => {
      const current = prev[entityKey] || [];
      return { ...prev, [entityKey]: current.filter(t => t.id !== taskId) };
    });
  };

  const handleGenerate = async () => {
    setCardState(prev => ({ ...prev, isGenerating: true, progress: 10 }));
    
    try {
      const progressInterval = setInterval(() => {
        setCardState(prev => ({ ...prev, progress: Math.min(prev.progress + 15, 80) }));
      }, 500);

      let start_time = "2026-04-01 00:00:00";
      let end_time = "2026-04-30 23:59:59";
      if (dateRange === '1w') {
        start_time = "2026-04-24 00:00:00";
      }

      // We still use mock data fetch
      const payload = {
        uid: "134209751",
        partition: "202604",
        schema: selectedSchemaKey,
        entityTasks,
        start_time,
        end_time
      };

      const res = await fetch('http://localhost:3000/api/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      
      clearInterval(progressInterval);
      setCardState(prev => ({ ...prev, isGenerating: false, progress: 100, step: 3, finished: true }));
      
      // Compute context slot IDs dynamically based on the schema
      const slotsContext = Object.keys(schema.entities).map(entityKey => {
        const entityTasksList = entityTasks[entityKey];
        if (!entityTasksList || entityTasksList.length === 0) return null;
        
        const entityConfig = schema.entities[entityKey];
        return entityConfig.applicable_charts.map((chart: any) => {
          return `- ${entityConfig.description} - ${chart.chart_title}: <UPDATE_INSIGHT target="${entityKey}_${chart.sampling_key}">`;
        }).join('\n');
      }).filter(Boolean).join('\n');

      setTimeout(async () => {
        if (onLockInput) onLockInput(false);
        // Pass dynamic config to RightSidebar
        onOpenWorkspace?.({ reportType: 'dynamic_schema', schemaKey: selectedSchemaKey, entityTasks, dateRange, esData: result });
        
        try {
          const contextMsg = `[系统通知] 用户刚刚成功在右侧大屏生成了一份基于 "${schema.report_name}" 的动态报告。
【报告配置】: 数据周期为 ${dateRange === '1w' ? '最近一周 (2026-04-24至2026-04-30)' : dateRange}。
【底层引擎配置】: UID为 "${payload.uid}", Partition为 "${payload.partition}"。

【⚠️ 高阶操作指令 ⚠️】
当用户要求获取数据或执行分析时，你**必须**使用 shell 工具调用底层 Python 脚本。
1. 如果用户在对话中明确指定了某项技能（例如以 /advanced_chart_sampling 开头），你可以跳过查询目录的步骤，**直接**执行 ["python", "skills/get_skill_doc.py", "<该技能名>"] 来查阅其说明书。
2. 如果用户未明确指定，请先执行 ["cat", "skills/catalog.json"] 查看有哪些可用技能，然后再使用 get_skill_doc.py 了解用法。绝对不要捏造不存在的脚本！
3. 实际执行技能获取数据时，务必在 JSON 参数中携带 "uid" 和 "partition"。

【✨ 大屏动态注入指令 (Generative UI) ✨】
右侧大屏已根据动态 Schema 渲染完毕。当前大屏支持的动态洞察插槽如下：
${slotsContext}

你必须在对话回复的末尾输出以下代码块来实现内容覆盖（注意替换图表ID）：
<UPDATE_INSIGHT target="图表ID">
这里写你要更新到右侧大屏的深度洞察内容...
</UPDATE_INSIGHT>
这部分代码会被系统拦截并直接投射到大屏，用户能看到打字机效果！`;
          
          await fetch(`http://localhost:3000/api/sessions/${sessionId}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: [
                { role: 'user', content: contextMsg },
                { role: 'assistant', content: '[隐藏回复] 收到，我已经了解了动态报告的插槽结构和底层配置上下文。我将在后续回答中精准投射数据。' }
              ]
            })
          });
        } catch(e) { console.error("Failed to inject context", e); }
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
            </select>
          </div>
        </div>
        
        {cardState.step === 1 && !cardState.isGenerating && (
          <div className={styles.cardBody}>
            <div className={styles.tagSection}>
              <div className={styles.tagLabel}>报告模板：</div>
              <select value={selectedSchemaKey} onChange={e => setSelectedSchemaKey(e.target.value)} className={styles.categoryTitleInput} style={{marginBottom: 10, padding: 8}}>
                {Object.keys(REPORT_SCHEMAS).map(k => (
                  <option key={k} value={k}>{REPORT_SCHEMAS[k].report_name}</option>
                ))}
              </select>
            </div>

            {Object.keys(schema.entities).map(entityKey => {
               const entityConfig = schema.entities[entityKey];
               const currentTasks = entityTasks[entityKey] || [];
               return (
                 <div key={entityKey} className={styles.categoryBlock}>
                   <div className={styles.categoryHeader}>
                     <i className="ri-folder-2-fill"></i> {entityConfig.description} ({entityKey})
                   </div>
                   <div className={styles.tagSection}>
                     <div className={styles.tagLabel}>分配分析任务：</div>
                     <div className={styles.pillContainer}>
                       {currentTasks.map(t => (
                         <span key={t.id} className={styles.pillTag}>
                           {t.name} <i className="ri-close-line" onClick={() => removeTask(entityKey, t.id)}></i>
                         </span>
                       ))}
                       <select className={styles.addSelect} onChange={(e) => handleAddTask(entityKey, e)} defaultValue="">
                         <option value="" disabled>+ 添加任务</option>
                         {availableTasks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                       </select>
                     </div>
                   </div>
                 </div>
               );
            })}

            <div className={styles.cardFooter}>
              <button className={styles.cancelBtn} onClick={() => setCardState(p => ({...p, finished: true}))}>取消</button>
              <button className={styles.confirmBtn} onClick={handleGenerate}>一键生成标准大屏</button>
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
            onClick={() => onOpenWorkspace?.({ reportType: 'dynamic_schema', schemaKey: selectedSchemaKey, entityTasks, dateRange, esData: null })}
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
