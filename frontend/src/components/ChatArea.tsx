import React, { useState, useRef, useEffect } from 'react';
import styles from './ChatArea.module.css';
import MessageRenderer from './MessageRenderer';

interface ChatAreaProps {
  userId: string;
  currentSessionId: string | null;
  onShowCitation: (text: string) => void;
  onOpenWorkspace: (config: any) => void;
  onUpdateInsight?: (target: string, text: string) => void;
}

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
}

const SKILLS = [
  { id: "generate_report", brief: "🚀 快速创建一份全景数据分析报告，呼出大屏图表配置面板。" },
  { id: "es_agg_search", brief: "执行宏观数据统计与聚合。支持声量份额(sov)、趋势(trend)等统计。" },
  { id: "es_sample_search", brief: "微观聚类抽样。基于相似度指纹获取特定任务下长文本，用于归因分析。" },
  { id: "query_reimbursement_policy", brief: "查询公司内部的差旅、打车、餐饮等报销制度和规定。" },
  { id: "check_reimbursement_progress", brief: "查询某位员工当前报销单的审批进度状态。" },
  { id: "send_feishu_message", brief: "向指定员工、部门负责人或主管发送一条飞书消息或提醒。" },
  { id: "web_search", brief: "浅度联网搜索：查询互联网上的实时信息、新闻、百科等外部客观事实。" },
  { id: "deep_web_crawl", brief: "深度网页阅读：提供具体的URL链接，抓取并读取完整长篇内容。" },
  { id: "advanced_chart_sampling", brief: "高级图表抽样规范指南：包含 9 种图表的标准抽样逻辑与 JSON 输出契约说明书。" }
];

const NATIVE_TOOLS = [
  { id: "shell", brief: "执行宿主环境的 Bash/Python 脚本命令" },
  { id: "read_url", brief: "快速抓取并读取静态 URL 原始内容" },
  { id: "view_file", brief: "只读模式预览本地工作区文件" }
];

export default function ChatArea({ userId, currentSessionId, onShowCitation, onOpenWorkspace, onUpdateInsight }: ChatAreaProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [attachedFilePath, setAttachedFilePath] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [isInputLocked, setIsInputLocked] = useState(false);

  useEffect(() => {
    if (!currentSessionId) {
      setMessages([]);
      return;
    }

    const fetchHistory = async () => {
      try {
        const res = await fetch(`http://localhost:3000/api/sessions/${currentSessionId}/history`);
        const history = await res.json();
        
        const parsedMessages: Message[] = [];
        let currentAssistantMsg: Message | null = null;
        
        for (const item of history) {
          if (item.role === 'user') {
            if (currentAssistantMsg) {
              parsedMessages.push(currentAssistantMsg);
              currentAssistantMsg = null;
            }
            const text = typeof item.content === 'string' ? item.content : item.content.map((c:any) => c.text || '').join('');
            if (!text.startsWith('[系统通知]')) {
              parsedMessages.push({ id: Math.random().toString(), role: 'user', content: text });
            }
          } else if (item.role === 'assistant') {
            if (!currentAssistantMsg) {
              currentAssistantMsg = { id: Math.random().toString(), role: 'assistant', content: '' };
            }
            let textDelta = typeof item.content === 'string' 
              ? item.content 
              : (Array.isArray(item.content) ? item.content.map((c:any) => c.text || '').join('') : '');
            if (item.tool_calls) {
              textDelta += "\n<tool_call>\n```json\n" + JSON.stringify(item.tool_calls, null, 2) + "\n```\n</tool_call>\n";
            }
            if (!textDelta.startsWith('[隐藏回复]')) {
              currentAssistantMsg.content += textDelta;
            }
          } else if (item.role === 'tool') {
            if (!currentAssistantMsg) {
              currentAssistantMsg = { id: Math.random().toString(), role: 'assistant', content: '' };
            }
            currentAssistantMsg.content += "\n<tool_result>\n```\n" + item.content + "\n```\n</tool_result>\n";
          }
        }
        if (currentAssistantMsg) {
          parsedMessages.push(currentAssistantMsg);
        }
        setMessages(parsedMessages);
      } catch (e) {
        console.error(e);
        setMessages([]);
      }
    };

    fetchHistory();
  }, [currentSessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  useEffect(() => {
    if (!onUpdateInsight) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === 'assistant') {
      const regex = /<\s*UPDATE_INSIGHT\s+target=['"]([^'"]+)['"]\s*>([\s\S]*?)(?:<\/\s*UPDATE_INSIGHT\s*>|$)/gi;
      let match;
      while ((match = regex.exec(lastMsg.content)) !== null) {
        onUpdateInsight(match[1], match[2]);
      }
    }
  }, [messages, onUpdateInsight]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!currentSessionId || !e.target.files || e.target.files.length === 0) return;
    
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`http://localhost:3000/api/sessions/${currentSessionId}/upload`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.status === 'success') {
        setAttachedFilePath(data.filePath);
      }
    } catch (err) {
      console.error("Upload failed", err);
    }
  };

  const sendPrompt = async (promptText: string) => {
    if (!currentSessionId || isStreaming) return;
    
    const userMsgId = Date.now().toString();
    setMessages(prev => [...prev, { id: userMsgId, role: 'user', content: promptText }]);
    setInput('');
    setAttachedFilePath(null);
    setIsStreaming(true);

    const assistantMsgId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, { id: assistantMsgId, role: 'assistant', content: '' }]);

    // ==== MOCK INTERCEPTOR ====
    if (!promptText.startsWith('/') && (promptText.includes('分析') || promptText.includes('报告') || promptText.includes('月报') || promptText.includes('监测'))) {
      setTimeout(() => {
        setMessages(prev => prev.map(m => 
          m.id === assistantMsgId 
            ? { ...m, content: "好的，我已经为您初步理解了需求。请在下方弹出的卡片中完成多维度分析的配置。\n\n[WORKSPACE_SCHEMA_START]{\"mock\":true}[WORKSPACE_SCHEMA_END]" }
            : m
        ));
        setIsStreaming(false);
      }, 800);
      return;
    }
    // ==========================

    try {
      abortControllerRef.current = new AbortController();
      const response = await fetch(`http://localhost:3000/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortControllerRef.current.signal,
        body: JSON.stringify({
          prompt: promptText,
          sessionId: currentSessionId,
          userId,
          model: 'MiniMax-M2.7',
          provider: 'openai'
        })
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder('utf-8');
      
      if (reader) {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.replace('data: ', '');
              try {
                const event = JSON.parse(dataStr);
                
                if (event.type === 'item') {
                  const role = event.data.role;
                  
                  if (role === 'assistant' && event.data.content) {
                    let textDelta = typeof event.data.content === 'string' 
                      ? event.data.content 
                      : (event.data.content[0]?.text || '');

                    if (event.data.tool_calls) {
                      const toolsStr = "\n<tool_call>\n```json\n" + JSON.stringify(event.data.tool_calls, null, 2) + "\n```\n</tool_call>\n";
                      textDelta += toolsStr;
                    }

                    setMessages(prev => prev.map(m => 
                      m.id === assistantMsgId 
                        ? { ...m, content: m.content + textDelta }
                        : m
                    ));
                  } else if (role === 'tool') {
                    const toolOutput = "\n<tool_result>\n```\n" + event.data.content + "\n```\n</tool_result>\n";
                    setMessages(prev => prev.map(m => 
                      m.id === assistantMsgId 
                        ? { ...m, content: m.content + toolOutput }
                        : m
                    ));
                  }
                } else if (event.type === 'done' || event.type === 'exit') {
                  setIsStreaming(false);
                }
              } catch (e) {
                // ignore parsing error for incomplete chunks
              }
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log("Chat aborted by user");
        setMessages(prev => prev.map(m => 
          m.id === assistantMsgId 
            ? { ...m, content: m.content + "\n\n*[用户已手动中断对话]*" }
            : m
        ));
      } else {
        console.error("Chat error", err);
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const handleSend = () => {
    if (isStreaming) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      return;
    }
    if ((!input.trim() && !attachedFilePath)) return;
    let finalPrompt = input;
    if (attachedFilePath) {
      finalPrompt = `请参考附件 ${attachedFilePath}。 ${input}`;
    }
    sendPrompt(finalPrompt);
  };

  const renderWelcomeScreen = () => (
    <div className={styles.emptyState}>
      <h2>你好，我是你的智能分析助手。</h2>
      <p>您可以直接向我提问，或选择快速生成以下专业报告：</p>
      <div className={styles.presetCapsules}>
        <button onClick={() => sendPrompt("我想生成一份【品牌月报】")}><i className="ri-bar-chart-box-line"></i> 品牌月报</button>
        <button onClick={() => sendPrompt("我想生成一份【竞品分析】报告，请提供配置面板")}><i className="ri-sword-line"></i> 竞品分析</button>
        <button onClick={() => sendPrompt("我想生成一份【议题监测】")}><i className="ri-radar-line"></i> 议题监测</button>
        <button onClick={() => sendPrompt("我想生成一份【领导人声誉】报告")}><i className="ri-user-star-line"></i> 领导人声誉</button>
      </div>
    </div>
  );

  return (
    <div className={styles.chatArea}>
      {!currentSessionId ? (
        <div className={styles.emptyState}>
          <h2>你好，</h2>
          <p>请在左侧选择或新建一个会话开始探索。</p>
        </div>
      ) : (
        <>
          <div className={styles.messageList}>
            {messages.length === 0 && renderWelcomeScreen()}
            {messages.map(msg => (
              <div key={msg.id} className={`${styles.messageWrapper} ${styles[msg.role]}`}>
                <div className={styles.avatar}>
                  {msg.role === 'user' ? <i className="ri-user-line"></i> : <i className="ri-robot-2-fill"></i>}
                </div>
                <div className={styles.messageContent}>
                  <MessageRenderer 
                    content={msg.content.replace(/<\s*UPDATE_INSIGHT\s+target=['"][^'"]+['"]\s*>([\s\S]*?)(?:<\/\s*UPDATE_INSIGHT\s*>|$)/gi, '\n\n*[✨ 正在将深度洞察投射至右侧大屏...]*\n\n')} 
                    onShowCitation={onShowCitation} 
                    onOpenWorkspace={onOpenWorkspace} 
                    onLockInput={setIsInputLocked}
                    sessionId={currentSessionId} 
                  />
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className={styles.inputContainer} style={{ position: 'relative' }}>
            {/* Slash Command Autocomplete Menu */}
            {input.startsWith('/') && !input.includes(' ') && (
              <div className={styles.slashMenu}>
                {SKILLS.filter(s => s.id.toLowerCase().includes(input.slice(1).toLowerCase()) || s.brief.includes(input.slice(1).toLowerCase())).map(skill => (
                  <button 
                    key={skill.id}
                    className={styles.dropdownItem}
                    onClick={() => {
                      const hasReportConfig = messages.some(m => m.content.includes('[WORKSPACE_SCHEMA_START]'));
                      const needsReport = ['es_agg_search', 'es_sample_search', 'advanced_chart_sampling'];
                      if (skill.id === 'generate_report' || (needsReport.includes(skill.id) && !hasReportConfig)) {
                        setInput('我想生成一份全景分析报告，请提供高级报告配置面板。');
                      } else if (skill.id === 'advanced_chart_sampling') {
                        setInput(`/${skill.id} 帮我按规范抽样分析一下大屏图表：`);
                      } else {
                        setInput(`/${skill.id} `);
                      }
                      textareaRef.current?.focus();
                    }}
                  >
                    <span>/ {skill.id}</span>
                    <small>{skill.brief}</small>
                  </button>
                ))}
                {SKILLS.filter(s => s.id.toLowerCase().includes(input.slice(1).toLowerCase()) || s.brief.includes(input.slice(1).toLowerCase())).length === 0 && (
                  <div className={styles.slashMenuEmpty}>无匹配的 Skills...</div>
                )}
              </div>
            )}
            
            <div className={`${styles.inputBox} ${isInputLocked ? styles.locked : ''}`}>
              {attachedFilePath && (
                <div className={styles.attachmentBadge}>
                  <i className="ri-attachment-2"></i> {attachedFilePath.split('/').pop()}
                  <i className="ri-close-circle-fill" onClick={() => setAttachedFilePath(null)} style={{cursor: 'pointer', marginLeft: '8px'}}></i>
                </div>
              )}
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={isInputLocked ? "⚠️ 请先完成上方卡片内的报告配置" : "问任何问题，@模型 / 提示"}
                rows={2}
                disabled={isInputLocked}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!isInputLocked) handleSend();
                  }
                }}
              />
              <div className={styles.inputActions}>
                <div className={styles.leftActions}>
                  <input 
                    type="file" 
                    style={{display: 'none'}} 
                    ref={fileInputRef} 
                    onChange={handleFileUpload}
                  />
                  <button onClick={() => fileInputRef.current?.click()} title="添加附件" disabled={isInputLocked}>
                    <i className="ri-attachment-line"></i>
                  </button>
                  
                  {/* Skills Dropdown */}
                  <div className={styles.dropdownContainer}>
                    <button disabled={isInputLocked} type="button"><i className="ri-book-read-line"></i> Skills</button>
                    <div className={styles.dropdown}>
                      <div className={styles.dropdownContent}>
                        {SKILLS.map(skill => (
                          <button 
                            key={skill.id}
                            className={styles.dropdownItem}
                            onClick={() => {
                              const hasReportConfig = messages.some(m => m.content.includes('[WORKSPACE_SCHEMA_START]'));
                              const needsReport = ['es_agg_search', 'es_sample_search', 'advanced_chart_sampling'];
                              if (skill.id === 'generate_report' || (needsReport.includes(skill.id) && !hasReportConfig)) {
                                setInput('我想生成一份全景分析报告，请提供高级报告配置面板。');
                              } else if (skill.id === 'advanced_chart_sampling') {
                                setInput(`/${skill.id} 帮我按规范抽样分析一下大屏图表：`);
                              } else {
                                setInput(`/${skill.id} `);
                              }
                              textareaRef.current?.focus();
                            }}
                          >
                            <span>/ {skill.id}</span>
                            <small>{skill.brief}</small>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Tools Dropdown */}
                  <div className={styles.dropdownContainer}>
                    <button disabled={isInputLocked} type="button"><i className="ri-tools-line"></i> 工具</button>
                    <div className={styles.dropdown}>
                      <div className={styles.dropdownContent}>
                        {NATIVE_TOOLS.map(tool => (
                          <div key={tool.id} className={styles.dropdownItem} style={{cursor: 'default'}}>
                            <span><i className="ri-terminal-box-line"></i> {tool.id}</span>
                            <small>{tool.brief}</small>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className={styles.rightActions}>
                  <button 
                    className={`${styles.sendBtn} ${isStreaming ? styles.streaming : ''}`} 
                    onClick={handleSend}
                    disabled={isInputLocked}
                  >
                    {isStreaming ? <i className="ri-stop-circle-line"></i> : <i className="ri-send-plane-fill"></i>}
                  </button>
                </div>
              </div>
            </div>
            <div className={styles.inputFooter}>
              企业级 Agent 平台由底座提供支持。内容由 AI 生成，请注意甄别。
            </div>
          </div>
        </>
      )}
    </div>
  );
}
