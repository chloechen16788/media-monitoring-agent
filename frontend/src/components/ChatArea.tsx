import React, { useState, useRef, useEffect } from 'react';
import styles from './ChatArea.module.css';
import MessageRenderer from './MessageRenderer';

interface ChatAreaProps {
  userId: string;
  currentSessionId: string | null;
  onShowCitation: (text: string) => void;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
}

export default function ChatArea({ userId, currentSessionId, onShowCitation }: ChatAreaProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [attachedFilePath, setAttachedFilePath] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
            parsedMessages.push({ id: Math.random().toString(), role: 'user', content: text });
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
            currentAssistantMsg.content += textDelta;
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

  const handleSend = async () => {
    if ((!input.trim() && !attachedFilePath) || !currentSessionId || isStreaming) return;

    let finalPrompt = input;
    if (attachedFilePath) {
      finalPrompt = `请参考附件 ${attachedFilePath}。 ${input}`;
    }

    const userMsgId = Date.now().toString();
    setMessages(prev => [...prev, { id: userMsgId, role: 'user', content: finalPrompt }]);
    setInput('');
    setAttachedFilePath(null);
    setIsStreaming(true);

    const assistantMsgId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, { id: assistantMsgId, role: 'assistant', content: '' }]);

    try {
      const response = await fetch(`http://localhost:3000/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: finalPrompt,
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
                  
                  // For simplicity, we append tool contents and assistant contents directly
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
    } catch (err) {
      console.error("Chat error", err);
    } finally {
      setIsStreaming(false);
    }
  };

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
            {messages.length === 0 && (
              <div className={styles.emptyState}>
                <h2>你好，</h2>
                <p>我今天能帮你什么？</p>
              </div>
            )}
            {messages.map(msg => (
              <div key={msg.id} className={`${styles.messageWrapper} ${styles[msg.role]}`}>
                <div className={styles.avatar}>
                  {msg.role === 'user' ? <i className="ri-user-line"></i> : <i className="ri-robot-2-fill"></i>}
                </div>
                <div className={styles.messageContent}>
                  <MessageRenderer content={msg.content} onShowCitation={onShowCitation} sessionId={currentSessionId} />
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className={styles.inputContainer}>
            <div className={styles.inputBox}>
              {attachedFilePath && (
                <div className={styles.attachmentBadge}>
                  <i className="ri-attachment-2"></i> {attachedFilePath.split('/').pop()}
                  <i className="ri-close-circle-fill" onClick={() => setAttachedFilePath(null)} style={{cursor: 'pointer', marginLeft: '8px'}}></i>
                </div>
              )}
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="问任何问题，@模型 / 提示"
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
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
                  <button onClick={() => fileInputRef.current?.click()} title="添加附件">
                    <i className="ri-attachment-line"></i>
                  </button>
                  <button><i className="ri-lightbulb-flash-line"></i> 思考</button>
                  <button><i className="ri-tools-line"></i> 工具</button>
                </div>
                <div className={styles.rightActions}>
                  <button 
                    className={`${styles.sendBtn} ${isStreaming ? styles.streaming : ''}`} 
                    onClick={handleSend}
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
