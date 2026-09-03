import React, { useEffect, useMemo, useRef, useState } from 'react';
import styles from './ChatArea.module.css';
import MessageRenderer from './MessageRenderer';
import ParamRequestBar, {
  type DateRangeValue,
  type ParamRequestField,
  type ParamRequestPayload,
} from './ParamRequestBar';
import SkillFallbackBar, { type SkillFallbackPayload } from './SkillFallbackBar';
import DispatchConfirmBar from './DispatchConfirmBar';
import { apiUrl } from '../config/api';

type AgentMode = 'master' | 'sub';

interface ChatAreaProps {
  userId: string;
  projectId: string | null;
  currentSessionId: string | null;
  agentMode: AgentMode;
  onChangeAgentMode: (mode: AgentMode) => Promise<boolean>;
  onShowCitation: (text: string) => void;
  onOpenTaskBoard: () => void;
  onOpenWorkspace: (config: any) => void;
  onUpdateInsight?: (target: string, text: string) => void;
  onTaskContractChanged?: () => void;
  subDispatchSignal: number;
  devVisible?: boolean;
  onSessionTitleUpdated?: () => void;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  producedBy?: AgentMode;
}

interface SkillItem {
  id: string;
  brief?: string;
  role?: string;
  type?: string;
  enabled?: boolean;
}

const NATIVE_TOOLS = [
  { id: 'shell', brief: '执行宿主环境的 Bash/Python 脚本命令' },
  { id: 'read_url', brief: '快速抓取并读取静态 URL 原始内容' },
  { id: 'view_file', brief: '只读模式预览本地工作区文件' },
];

const SUB_EXEC_PROMPT =
  '请严格按照当前 task_contract 执行任务，仅使用 allowed_skills 并返回结构化执行结果。';
const PROCESS_BLOCK_REGEX = /<(think|tool_call|tool_result)>[\s\S]*?<\/\1>/gi;

function normalizeAttachmentPath(pathLike: string): string {
  // 兼容历史返回值 ./workspace/*，统一映射到 session cwd 可访问的 ./uploads/*
  if (pathLike.startsWith('./workspace/')) {
    return pathLike.replace('./workspace/', './uploads/');
  }
  return pathLike;
}

export default function ChatArea({
  userId,
  projectId,
  currentSessionId,
  agentMode,
  onChangeAgentMode,
  onShowCitation,
  onOpenTaskBoard,
  onOpenWorkspace,
  onUpdateInsight,
  onTaskContractChanged,
  subDispatchSignal,
  devVisible = false,
  onSessionTitleUpdated,
}: ChatAreaProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [liveProgress, setLiveProgress] = useState('');
  const [attachedFilePath, setAttachedFilePath] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [displayAgentMode, setDisplayAgentMode] = useState<AgentMode>(agentMode);
  const [pendingDispatchConfirm, setPendingDispatchConfirm] = useState(false);
  const [paramRequest, setParamRequest] = useState<ParamRequestPayload | null>(null);
  const [paramValues, setParamValues] = useState<
    Record<string, string | DateRangeValue | undefined>
  >({});
  const [paramErrors, setParamErrors] = useState<Record<string, string>>({});
  const [paramShakeToken, setParamShakeToken] = useState(0);
  const [skillFallback, setSkillFallback] = useState<SkillFallbackPayload | null>(null);
  const [pendingContract, setPendingContract] = useState<any>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isStreamingRef = useRef(false);
  const lastAssistantChunkAtRef = useRef(0);
  const hasAssistantChunkRef = useRef(false);
  const queuedPromptRef = useRef<string | null>(null);
  const abortReasonRef = useRef<string>('manual');
  const pendingSubDispatchRef = useRef(false);
  const dispatchingSubRef = useRef(false);
  const isFirstMessageRef = useRef(true);
  const turnStartRef = useRef<number>(0);
  const wroteContractThisTurnRef = useRef(false);

  const [isInputLocked, setIsInputLocked] = useState(false);

  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    setDisplayAgentMode(agentMode);
  }, [agentMode]);

  useEffect(() => {
    setPendingDispatchConfirm(false);
    setPendingContract(null);
    setParamRequest(null);
    setParamValues({});
    setParamErrors({});
    setSkillFallback(null);
    isFirstMessageRef.current = true;
  }, [currentSessionId]);

  const slashSkills = useMemo(() => {
    const keyword = input.slice(1).toLowerCase();
    return skills.filter(
      (skill) =>
        skill.id.toLowerCase().includes(keyword) ||
        String(skill.brief || '').toLowerCase().includes(keyword)
    );
  }, [input, skills]);

  useEffect(() => {
    if (!currentSessionId || !projectId) {
      setMessages([]);
      return;
    }

    const fetchHistory = async () => {
      try {
        const res = await fetch(
          apiUrl(
            `/api/sessions/${currentSessionId}/history?userId=${encodeURIComponent(
              userId
            )}&projectId=${encodeURIComponent(projectId)}`
          )
        );
        const history = await res.json();
        const parsedMessages: Message[] = [];
        let currentAssistantMsg: Message | null = null;

        for (const item of history) {
          if (item.role === 'user') {
            if (currentAssistantMsg) {
              parsedMessages.push(currentAssistantMsg);
              currentAssistantMsg = null;
            }
            const text =
              typeof item.content === 'string'
                ? item.content
                : item.content.map((c: any) => c.text || '').join('');
            if (!text.startsWith('[系统通知]')) {
              parsedMessages.push({ id: Math.random().toString(), role: 'user', content: text });
            }
          } else if (item.role === 'assistant') {
            if (!currentAssistantMsg) {
              currentAssistantMsg = { id: Math.random().toString(), role: 'assistant', content: '' };
            }
            let textDelta =
              typeof item.content === 'string'
                ? item.content
                : Array.isArray(item.content)
                ? item.content.map((c: any) => c.text || '').join('')
                : '';
            if (item.tool_calls) {
              textDelta += `\n<tool_call>\n\`\`\`json\n${JSON.stringify(
                item.tool_calls,
                null,
                2
              )}\n\`\`\`\n</tool_call>\n`;
            }
            if (!textDelta.startsWith('[隐藏回复]')) {
              currentAssistantMsg.content += textDelta;
            }
          } else if (item.role === 'tool') {
            if (!currentAssistantMsg) {
              currentAssistantMsg = { id: Math.random().toString(), role: 'assistant', content: '' };
            }
            currentAssistantMsg.content += `\n<tool_result>\n\`\`\`\n${item.content}\n\`\`\`\n</tool_result>\n`;
          }
        }
        if (currentAssistantMsg) {
          if (currentAssistantMsg.content.includes('[WORKSPACE_SCHEMA_START]')) {
            currentAssistantMsg.producedBy = 'sub';
          }
          parsedMessages.push(currentAssistantMsg);
        }
        setMessages(parsedMessages);
      } catch (e) {
        console.error(e);
        setMessages([]);
      }
    };

    fetchHistory();
  }, [currentSessionId, projectId, userId]);

  useEffect(() => {
    const fetchSkills = async () => {
      try {
        // 拉取全部启用技能（不按角色过滤），让用户可显式指定任意 skill；
        // 执行权限仍由 agent-core 的 ToolRegistry 按角色限制，此处仅是可见性。
        const res = await fetch(
          apiUrl(`/api/skills/registry?enabled=true&userId=${encodeURIComponent(userId)}`)
        );
        const data = await res.json();
        const all: SkillItem[] = Array.isArray(data.skills) ? data.skills : [];
        // 只保留可执行技能（script），排除文档类；当前角色可执行的排前面。
        const execSkills = all.filter((s) => s.type === 'script');
        execSkills.sort((a, b) => {
          const ap = a.role === agentMode ? 0 : 1;
          const bp = b.role === agentMode ? 0 : 1;
          if (ap !== bp) return ap - bp;
          return a.id.localeCompare(b.id);
        });
        setSkills(execSkills);
      } catch (e) {
        console.error('Failed to fetch skills registry', e);
        setSkills([]);
      }
    };
    fetchSkills();
  }, [agentMode, userId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  const validateParamField = (
    field: ParamRequestField,
    value: string | DateRangeValue | undefined
  ): string => {
    const isMissingText = value == null || (typeof value === 'string' && value.trim() === '');
    if (field.type === 'daterange') {
      const range = value as DateRangeValue | undefined;
      const start = range?.start || '';
      const end = range?.end || '';
      if (field.required && (!start || !end)) {
        return field.hint || `${field.label} 为必填`;
      }
      if (start && end && start > end) {
        return field.hint || `${field.label} 开始时间不能晚于结束时间`;
      }
      return '';
    }

    if (field.required && isMissingText) {
      return field.hint || `${field.label} 为必填`;
    }
    if (isMissingText) return '';
    if (typeof value === 'string' && field.pattern) {
      try {
        const re = new RegExp(field.pattern);
        if (!re.test(value.trim())) {
          return field.hint || `${field.label} 格式不正确`;
        }
      } catch {
        return '';
      }
    }
    return '';
  };

  const buildParamPayload = () => {
    if (!paramRequest) return null;
    const payload: Record<string, any> = {};
    for (const field of paramRequest.fields) {
      const value = paramValues[field.key];
      if (value == null || value === '') continue;
      if (field.type === 'daterange' && typeof value === 'object') {
        const start = value.start || '';
        const end = value.end || '';
        payload[field.key] = { start, end };
        const startKey =
          field.start_key || (field.key === 'time_range' ? 'start_time' : `${field.key}_start`);
        const endKey =
          field.end_key || (field.key === 'time_range' ? 'end_time' : `${field.key}_end`);
        payload[startKey] = start;
        payload[endKey] = end;
        continue;
      }

      if (typeof value === 'string' && field.key === 'task_ids') {
        payload[field.key] = value
          .split(',')
          .map((item) => Number(item.trim()))
          .filter((item) => Number.isFinite(item));
        continue;
      }
      payload[field.key] = value;
    }
    return payload;
  };

  useEffect(() => {
    // 投射指令是 Sub 专属（规范第 7 节：Master 不输出 Generative UI 魔法码），
    // Master 计划文本里的字面提及不得触发投射。
    if (!onUpdateInsight || agentMode === 'master') return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === 'assistant') {
      const cleanContent = lastMsg.content.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '');
      // (?<!`) 忽略反引号内的字面提及（如计划描述「通过 `<UPDATE_INSIGHT ...>` 投射」）
      const regex = /(?<!`)<\s*UPDATE_INSIGHT\s+target=['"]([^'"]+)['"]\s*>([\s\S]*?)(?:<\/\s*UPDATE_INSIGHT\s*>|$)/gi;
      let match;
      while ((match = regex.exec(cleanContent)) !== null) {
        onUpdateInsight(match[1], match[2]);
      }
    }
  }, [messages, onUpdateInsight, agentMode]);

  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'assistant') return;
    if (lastMsg.producedBy === 'sub') return;

    const cleanContent = lastMsg.content.replace(PROCESS_BLOCK_REGEX, '');
    if (
      cleanContent.includes('[PARAM_REQUEST_START]') &&
      !cleanContent.includes('[PARAM_REQUEST_END]')
    ) {
      return;
    }

    const regex = /(?<!`)\[PARAM_REQUEST_START\]([\s\S]*?)\[PARAM_REQUEST_END\]/g;
    let match: RegExpExecArray | null;
    let latest: ParamRequestPayload | null = null;
    while ((match = regex.exec(cleanContent)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        if (!parsed || !Array.isArray(parsed.fields)) continue;
        const fields: ParamRequestField[] = parsed.fields
          .filter((field: any) => field && typeof field.key === 'string' && typeof field.label === 'string')
          .map((field: any) => {
            const type = ['text', 'select', 'date', 'daterange'].includes(field.type)
              ? field.type
              : 'text';
            return {
              key: field.key,
              label: field.label,
              type,
              required: Boolean(field.required),
              placeholder: field.placeholder ? String(field.placeholder) : undefined,
              pattern: field.pattern ? String(field.pattern) : undefined,
              hint: field.hint ? String(field.hint) : undefined,
              options: Array.isArray(field.options)
                ? field.options
                    .filter((item: any) => item && item.value != null && item.label != null)
                    .map((item: any) => ({
                      value: String(item.value),
                      label: String(item.label),
                    }))
                : undefined,
              start_key: field.start_key ? String(field.start_key) : undefined,
              end_key: field.end_key ? String(field.end_key) : undefined,
            } as ParamRequestField;
          });
        if (fields.length > 0) {
          latest = {
            title: parsed.title ? String(parsed.title) : undefined,
            fields,
          };
        }
      } catch {
        // ignore malformed payload
      }
    }

    if (latest) {
      setParamRequest(latest);
      setParamValues({});
      setParamErrors({});
      setParamShakeToken(0);
    }
  }, [messages]);

  // 解析 SKILL_FALLBACK 魔法码：Sub 检测到技能缺口时触发
  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'assistant' || lastMsg.producedBy !== 'sub') return;

    const cleanContent = lastMsg.content.replace(PROCESS_BLOCK_REGEX, '');
    if (
      cleanContent.includes('[SKILL_FALLBACK_START]') &&
      !cleanContent.includes('[SKILL_FALLBACK_END]')
    ) {
      return; // 等流式完整
    }

    const regex = /(?<!`)\[SKILL_FALLBACK_START\]([\s\S]*?)\[SKILL_FALLBACK_END\]/g;
    let match: RegExpExecArray | null;
    let latest: SkillFallbackPayload | null = null;
    while ((match = regex.exec(cleanContent)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        if (parsed && typeof parsed.message === 'string') {
          latest = {
            message: parsed.message,
            missing_skills: Array.isArray(parsed.missing_skills) ? parsed.missing_skills : undefined,
            context: parsed.context ? String(parsed.context) : undefined,
          };
        }
      } catch {
        // ignore malformed payload
      }
    }
    if (latest) {
      setSkillFallback(latest);
    }
  }, [messages]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!currentSessionId || !projectId || !e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(
        apiUrl(
          `/api/sessions/${currentSessionId}/upload?userId=${encodeURIComponent(
            userId
          )}&projectId=${encodeURIComponent(projectId)}`
        ),
        { method: 'POST', body: formData }
      );
      const data = await res.json();
      if (data.status === 'success') {
        setAttachedFilePath(normalizeAttachmentPath(String(data.filePath || '')));
      }
    } catch (err) {
      console.error('Upload failed', err);
    }
  };

  const fetchTaskContract = async () => {
    if (!projectId) return null;
    try {
      const res = await fetch(
        apiUrl(
          `/api/projects/${encodeURIComponent(projectId)}/task-contract?userId=${encodeURIComponent(userId)}`
        ),
        { headers: { 'x-user-id': userId } }
      );
      if (!res.ok) return null;
      return res.json();
    } catch (e) {
      console.error('Failed to fetch task contract', e);
      return null;
    }
  };

  const shouldOfferSubDispatch = (contract: any) => {
    if (!contract?.goal) return false;
    if (!Array.isArray(contract.allowed_skills) || contract.allowed_skills.length === 0) {
      return false;
    }
    const status = String(contract?.status || 'planned').toLowerCase();
    if (status === 'executing') return false;
    // 只有本轮响应中检测到 write_task_contract 调用，才弹出确认
    // 避免历史遗留契约在新会话/打招呼时误触发
    if (!wroteContractThisTurnRef.current) return false;
    return true;
  };

  // 交接执行的就绪判断：与 shouldOfferSubDispatch 不同，executing 状态也允许
  // （TaskBoard 路径会先把契约推进到 executing 再触发交接信号）。
  const isContractDispatchable = (contract: any) => {
    if (!contract?.goal) return false;
    if (!Array.isArray(contract.allowed_skills) || contract.allowed_skills.length === 0) {
      return false;
    }
    const status = String(contract?.status || 'planned').toLowerCase();
    return ['planned', 'failed', 'executing'].includes(status);
  };

  const offerDispatchConfirm = async () => {
    const contract = await fetchTaskContract();
    if (!shouldOfferSubDispatch(contract)) return;
    setPendingContract(contract);
    setPendingDispatchConfirm(true);
  };

  const dispatchSubExecution = async () => {
    if (!currentSessionId || !projectId || dispatchingSubRef.current) return;
    if (isStreamingRef.current) {
      // 用户已确认交接：立即中断当前 Master 流，流结束后（finally）自动以 Sub 模式开始执行，
      // 不再静默排队等流自然结束（否则用户回车会以 Master 发消息，交接被丢弃）。
      pendingSubDispatchRef.current = true;
      queuedPromptRef.current = null;
      setPendingDispatchConfirm(false);
      setDisplayAgentMode('sub');
      abortReasonRef.current = 'dispatch';
      abortControllerRef.current?.abort();
      return;
    }
    dispatchingSubRef.current = true;
    setPendingDispatchConfirm(false);
    setDisplayAgentMode('sub');
    try {
      const contract = await fetchTaskContract();
      if (!isContractDispatchable(contract)) {
        setDisplayAgentMode('master');
        return;
      }
      const switched = await onChangeAgentMode('sub');
      if (!switched) {
        setDisplayAgentMode('master');
        return;
      }
      await sendPrompt(SUB_EXEC_PROMPT, { mode: 'sub', skipAutoDispatch: true });
    } finally {
      dispatchingSubRef.current = false;
    }
  };

  const handleConfirmDispatch = async () => {
    await dispatchSubExecution();
  };

  const updateSessionTitle = async (sessionId: string, firstMessage: string) => {
    const raw = firstMessage.replace(/[\r\n]+/g, ' ').trim();
    const title = [...raw].slice(0, 10).join('') || '新对话';
    try {
      await fetch(apiUrl(`/api/sessions/${encodeURIComponent(sessionId)}/title`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      onSessionTitleUpdated?.();
    } catch {
      // title update is best-effort
    }
  };

  const sendPrompt = async (
    promptText: string,
    options?: { mode?: AgentMode; skipAutoDispatch?: boolean }
  ) => {
    const requestMode = options?.mode ?? agentMode;
    if (!currentSessionId || !projectId || isStreamingRef.current) return;

    if (isFirstMessageRef.current) {
      isFirstMessageRef.current = false;
      updateSessionTitle(currentSessionId, promptText);
    }

    turnStartRef.current = Date.now();
    wroteContractThisTurnRef.current = false;
    const userMsgId = Date.now().toString();
    setMessages((prev) => [...prev, { id: userMsgId, role: 'user', content: promptText }]);
    setInput('');
    setAttachedFilePath(null);
    setIsStreaming(true);
    isStreamingRef.current = true;
    setLiveProgress('');
    lastAssistantChunkAtRef.current = 0;
    hasAssistantChunkRef.current = false;
    abortReasonRef.current = 'manual';

    const assistantMsgId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      { id: assistantMsgId, role: 'assistant', content: '', producedBy: requestMode },
    ]);

    let wasAborted = false;
    try {
      abortControllerRef.current = new AbortController();
      const response = await fetch(apiUrl('/api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortControllerRef.current.signal,
        body: JSON.stringify({
          prompt: promptText,
          sessionId: currentSessionId,
          userId,
          projectId,
          agentMode: requestMode,
          model: 'MiniMax-M2.7',
          provider: 'openai',
        }),
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
            if (!line.startsWith('data: ')) continue;
            const dataStr = line.replace('data: ', '');
            try {
              const event = JSON.parse(dataStr);
              if (event.type === 'progress') {
                // 长任务的实时进度（存活计时 + skill 打到 stderr 的真实进度），
                // 只用于展示，不进历史。新的模型输出到来时会被下方分支清掉。
                const skill = event.data?.skill ? `${event.data.skill}: ` : '';
                setLiveProgress(`${skill}${event.data?.message || ''}`);
                continue;
              }
              if (event.type === 'item') {
                const role = event.data.role;
                setLiveProgress('');
                if (role === 'assistant' && (event.data.content != null || event.data.tool_calls)) {
                  let textDelta =
                    typeof event.data.content === 'string'
                      ? event.data.content
                      : event.data.content && Array.isArray(event.data.content)
                      ? event.data.content[0]?.text || ''
                      : '';

                  if (event.data.tool_calls) {
                    const toolCallJson = JSON.stringify(event.data.tool_calls);
                    // 只检测实际的工具调用 JSON，不检测文字提及
                    if (requestMode === 'master' && toolCallJson.includes('write_task_contract')) {
                      wroteContractThisTurnRef.current = true;
                    }
                    textDelta += `\n<tool_call>\n\`\`\`json\n${JSON.stringify(
                      event.data.tool_calls,
                      null,
                      2
                    )}\n\`\`\`\n</tool_call>\n`;
                  }

                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsgId ? { ...m, content: m.content + textDelta } : m
                    )
                  );
                  lastAssistantChunkAtRef.current = Date.now();
                  hasAssistantChunkRef.current = true;
                  if (requestMode === 'master' && textDelta.includes('[WORKSPACE_SCHEMA_START]')) {
                    void offerDispatchConfirm();
                  }
                } else if (role === 'tool') {
                  const toolOutput = `\n<tool_result>\n\`\`\`\n${event.data.content}\n\`\`\`\n</tool_result>\n`;
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsgId ? { ...m, content: m.content + toolOutput } : m
                    )
                  );
                }
              } else if (event.type === 'done' || event.type === 'exit') {
                setLiveProgress('');
                onTaskContractChanged?.();
              }
            } catch (_e) {
              // ignore incomplete chunk
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        wasAborted = true;
        if (abortReasonRef.current === 'dispatch') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: `${m.content}\n\n*[已确认计划，交接给 Sub 执行]*` }
                : m
            )
          );
        } else if (abortReasonRef.current !== 'supersede') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: `${m.content}\n\n*[用户已手动中断对话]*` }
                : m
            )
          );
        }
      } else {
        console.error('Chat error', err);
      }
    } finally {
      setIsStreaming(false);
      isStreamingRef.current = false;
      setLiveProgress('');
      abortControllerRef.current = null;
      onTaskContractChanged?.();
      // Sub 交接优先于排队消息：用户点了「开始执行」就必须立刻交接，不能被后续输入抢占
      if (pendingSubDispatchRef.current) {
        pendingSubDispatchRef.current = false;
        queuedPromptRef.current = null;
        await dispatchSubExecution();
        return;
      }

      const queuedPrompt = queuedPromptRef.current;
      queuedPromptRef.current = null;
      if (queuedPrompt) {
        await sendPrompt(queuedPrompt);
        return;
      }

      if (requestMode === 'master' && !wasAborted && !options?.skipAutoDispatch) {
        await offerDispatchConfirm();
      }
    }
  };

  useEffect(() => {
    if (!subDispatchSignal || !currentSessionId || !projectId) return;
    setPendingDispatchConfirm(false);
    dispatchSubExecution();
  }, [subDispatchSignal, currentSessionId, projectId]);

  const handleSend = () => {
    const trimmedInput = input.trim();
    if (!projectId) return;

    let supplement = '';
    if (paramRequest) {
      const nextErrors: Record<string, string> = {};
      for (const field of paramRequest.fields) {
        const err = validateParamField(field, paramValues[field.key]);
        if (err) nextErrors[field.key] = err;
      }
      if (Object.keys(nextErrors).length > 0) {
        setParamErrors(nextErrors);
        setParamShakeToken((token) => token + 1);
        return;
      }
      const payload = buildParamPayload();
      if (payload && Object.keys(payload).length > 0) {
        supplement = `<用户补充参数>\n${JSON.stringify(payload, null, 2)}\n</用户补充参数>`;
      }
    }

    if (!trimmedInput && !attachedFilePath && !supplement) return;
    const normalizedAttachment = attachedFilePath ? normalizeAttachmentPath(attachedFilePath) : null;
    const basePrompt = normalizedAttachment ? `请参考附件 ${normalizedAttachment}。 ${input}` : input;
    const finalPrompt = supplement
      ? `${basePrompt}${basePrompt.trim() ? '\n\n' : ''}${supplement}`
      : basePrompt;

    if (isStreaming) {
      // 停止按钮与空回车：始终中止。长任务期间只有 progress、没有模型字，
      // 旧逻辑用「1.2s 无 assistant chunk」当成空闲，空输入会直接 return，停止键点了没反应。
      if (!trimmedInput && !attachedFilePath && !supplement) {
        abortReasonRef.current = 'manual';
        abortControllerRef.current?.abort();
        return;
      }
      if (paramRequest) {
        setParamRequest(null);
        setParamValues({});
        setParamErrors({});
        setParamShakeToken(0);
      }
      queuedPromptRef.current = finalPrompt;
      abortReasonRef.current = 'supersede';
      abortControllerRef.current?.abort();
      return;
    }

    if (paramRequest) {
      setParamRequest(null);
      setParamValues({});
      setParamErrors({});
      setParamShakeToken(0);
    }
    sendPrompt(finalPrompt);
  };

  // 契约由 Master 在 worker 内通过 write_task_contract 技能落盘（plan -> approve -> execute），
  // 前端不再用关键词启发式代写契约。
  const handlePresetPrompt = (text: string) => {
    sendPrompt(text);
  };

  const renderWelcomeScreen = () => (
    <div className={styles.emptyState}>
      <h2>你好，我是你的智能分析助手。</h2>
      <p>您可以直接向我提问，或选择快速生成以下专业报告：</p>
      <div className={styles.presetCapsules}>
        <button onClick={() => handlePresetPrompt('我想生成一份【品牌月报】')}>
          <i className="ri-bar-chart-box-line"></i> 品牌月报
        </button>
        <button onClick={() => handlePresetPrompt('我想生成一份【竞品分析】报告')}>
          <i className="ri-sword-line"></i> 竞品分析
        </button>
        <button onClick={() => handlePresetPrompt('我想生成一份【议题监测】')}>
          <i className="ri-radar-line"></i> 议题监测
        </button>
        <button onClick={() => handlePresetPrompt('我想生成一份【领导人声誉】报告')}>
          <i className="ri-user-star-line"></i> 领导人声誉
        </button>
      </div>
    </div>
  );

  // 角色标签样式：当前 agent 可执行的高亮，其它角色的灰显（仍可点选，权限不变）。
  const skillRoleTagStyle = (role: string): React.CSSProperties => {
    const active = role === agentMode;
    return {
      marginLeft: 6,
      fontStyle: 'normal',
      fontSize: 10,
      padding: '1px 6px',
      borderRadius: 6,
      background: active ? 'rgba(46,160,67,0.15)' : 'rgba(120,120,120,0.15)',
      color: active ? '#2ea043' : '#8a8f98',
      verticalAlign: 'middle',
    };
  };

  const applySkillPrompt = (skill: SkillItem) => {
    const hasReportConfig = messages.some((m) => m.content.includes('[WORKSPACE_SCHEMA_START]'));
    const needsReport = ['es_agg_search', 'es_sample_search', 'advanced_chart_sampling'];
    if (skill.id === 'generate_report' || (needsReport.includes(skill.id) && !hasReportConfig)) {
      setInput('帮我生成一份数据全景报告');
    } else if (skill.id === 'advanced_chart_sampling') {
      setInput(`/${skill.id} 帮我按规范抽样分析一下大屏图表：`);
    } else {
      setInput(`/${skill.id} `);
    }
    textareaRef.current?.focus();
  };

  return (
    <div className={styles.chatArea}>
      {!currentSessionId ? (
        <div className={styles.emptyState}>
          <h2>你好，</h2>
          <p>{projectId ? '请在左侧选择或新建一个会话开始探索。' : '请先选择一个项目。'}</p>
        </div>
      ) : (
        <>
          <div className={styles.agentBar}>
            <div className={styles.agentBarLeft}>
              <span className={styles.agentBarLabel}>当前 Agent</span>
              <div className={styles.modeSwitch}>
                <button
                  type="button"
                  className={displayAgentMode === 'master' ? styles.modeActive : ''}
                  onClick={async () => {
                    const ok = await onChangeAgentMode('master');
                    if (ok) {
                      setDisplayAgentMode('master');
                      setPendingDispatchConfirm(false);
                    }
                  }}
                >
                  Master · 规划
                </button>
                <button
                  type="button"
                  className={displayAgentMode === 'sub' ? styles.modeActiveSub : ''}
                  onClick={async () => {
                    const ok = await onChangeAgentMode('sub');
                    if (ok) setDisplayAgentMode('sub');
                  }}
                >
                  Sub · 执行
                </button>
              </div>
            </div>
            <div className={styles.agentBarRight}>
              {displayAgentMode === 'sub' ? (
                <span className={styles.agentStatusSub}>
                  <i className="ri-play-circle-fill"></i> Sub 已接手执行
                </span>
              ) : (
                <span className={styles.agentStatusMaster}>
                  <i className={pendingDispatchConfirm ? 'ri-checkbox-circle-line' : 'ri-compass-3-line'}></i>
                  {pendingDispatchConfirm ? ' 规划完成↓' : ' Master 规划中'}
                </span>
              )}
              {devVisible && (
                <button type="button" className={styles.boardBtn} onClick={onOpenTaskBoard}>
                  <i className="ri-kanban-view-2"></i> 任务看板
                </button>
              )}
            </div>
          </div>

          <div className={styles.messageList}>
            {messages.length === 0 && renderWelcomeScreen()}
            {messages.map((msg) => (
              <div key={msg.id} className={`${styles.messageWrapper} ${styles[msg.role]}`}>
                <div className={styles.avatar}>
                  {msg.role === 'user' ? <i className="ri-user-line"></i> : <i className="ri-robot-2-fill"></i>}
                </div>
                <div className={styles.messageContent}>
                  {msg.role === 'assistant' && msg.content === '' ? (
                    <div className={styles.thinkingDots}>
                      <span /><span /><span />
                    </div>
                  ) : (
                    <MessageRenderer
                      content={msg.content.replace(
                        // (?<!`) 反引号内的字面提及（Master 计划描述）按普通文本渲染，不显示投射占位符
                        /(?<!`)<\s*UPDATE_INSIGHT\s+target=['"][^'"]+['"]\s*>([\s\S]*?)(?:<\/\s*UPDATE_INSIGHT\s*>|$)/gi,
                        '\n\n*[✨ 正在将深度洞察投射至右侧大屏...]*\n\n'
                      )}
                      onShowCitation={onShowCitation}
                      onOpenWorkspace={onOpenWorkspace}
                      onLockInput={setIsInputLocked}
                      userId={userId}
                      projectId={projectId}
                      sessionId={currentSessionId}
                      agentMode={
                        msg.producedBy === 'sub'
                          ? 'sub'
                          : msg.producedBy === 'master'
                          ? 'master'
                          : displayAgentMode
                      }
                    />
                  )}
                </div>
              </div>
            ))}
            {isStreaming && liveProgress && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  margin: '4px 0 8px 52px',
                  fontSize: 12,
                  color: 'var(--text-secondary, #8a8f98)',
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                }}
              >
                <i className="ri-loader-4-line" style={{ animation: 'spin 1s linear infinite' }} />
                <span>{liveProgress}</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className={styles.inputContainer} style={{ position: 'relative' }}>

            {input.startsWith('/') && !input.includes(' ') && (
              <div className={styles.slashMenu}>
                {slashSkills.map((skill) => (
                  <button
                    key={skill.id}
                    className={styles.dropdownItem}
                    disabled={skill.enabled === false}
                    onClick={() => applySkillPrompt(skill)}
                  >
                    <span>
                      / {skill.id}
                      {skill.role && <em style={skillRoleTagStyle(skill.role)}>{skill.role}</em>}
                    </span>
                    <small>{skill.brief || '无描述'}</small>
                  </button>
                ))}
                {slashSkills.length === 0 && <div className={styles.slashMenuEmpty}>无匹配的 Skills...</div>}
              </div>
            )}

            <div className={`${styles.inputBox} ${isInputLocked ? styles.locked : ''}`}>
              {attachedFilePath && (
                <div className={styles.attachmentBadge}>
                  <i className="ri-attachment-2"></i> {attachedFilePath.split('/').pop()}
                  <i
                    className="ri-close-circle-fill"
                    onClick={() => setAttachedFilePath(null)}
                    style={{ cursor: 'pointer', marginLeft: '8px' }}
                  ></i>
                </div>
              )}
              {pendingDispatchConfirm && (
                <DispatchConfirmBar
                  goal={pendingContract?.goal}
                  onExecute={() => {
                    setPendingDispatchConfirm(false);
                    handleConfirmDispatch();
                  }}
                  onLater={() => setPendingDispatchConfirm(false)}
                />
              )}
              {skillFallback && (
                <SkillFallbackBar
                  payload={skillFallback}
                  onSwitchMaster={async (context) => {
                    setSkillFallback(null);
                    // 先切换到 Master 模式
                    await onChangeAgentMode('master');
                    // 再带着上下文自动发送重新规划请求
                    const masterPrompt = `[技能缺口] 请重新规划任务契约，加入所需技能后我会交给 Sub 执行。需求：${context}`;
                    sendPrompt(masterPrompt, { mode: 'master' });
                  }}
                  onContinue={() => {
                    // 用户选择忽略缺口，用现有技能继续，Sub 将自行决定怎么完成
                    setSkillFallback(null);
                    sendPrompt('请用当前契约里的现有技能尽力完成任务。', { mode: 'sub' });
                  }}
                  onDismiss={() => setSkillFallback(null)}
                />
              )}
              {paramRequest && (
                <ParamRequestBar
                  request={paramRequest}
                  values={paramValues}
                  errors={paramErrors}
                  shakeToken={paramShakeToken}
                  onChange={(fieldKey, value) => {
                    setParamValues((prev) => ({ ...prev, [fieldKey]: value }));
                  }}
                  onSetError={(fieldKey, error) => {
                    setParamErrors((prev) => ({ ...prev, [fieldKey]: error }));
                  }}
                  validateField={validateParamField}
                  onDismiss={() => {
                    // 模型给的输入项可能不符合用户意图：整体关闭后跳过参数校验，恢复自由对话
                    setParamRequest(null);
                    setParamValues({});
                    setParamErrors({});
                    setParamShakeToken(0);
                  }}
                />
              )}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={isInputLocked ? '⚠️ 请先完成上方卡片内的报告配置' : '问任何问题，@模型 / 提示'}
                rows={2}
                disabled={isInputLocked}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!isInputLocked) {
                      handleSend();
                    }
                  }
                }}
              />
              <div className={styles.inputActions}>
                <div className={styles.leftActions}>
                  <input type="file" style={{ display: 'none' }} ref={fileInputRef} onChange={handleFileUpload} />
                  <button onClick={() => fileInputRef.current?.click()} title="添加附件" disabled={isInputLocked}>
                    <i className="ri-attachment-line"></i>
                  </button>

                  <div className={styles.dropdownContainer}>
                    <button disabled={isInputLocked} type="button">
                      <i className="ri-book-read-line"></i> Skills
                    </button>
                    <div className={styles.dropdown}>
                      <div className={styles.dropdownContent}>
                        {skills.map((skill) => (
                          <button
                            key={skill.id}
                            className={styles.dropdownItem}
                            disabled={skill.enabled === false}
                            onClick={() => applySkillPrompt(skill)}
                          >
                            <span>
                              / {skill.id}
                              {skill.role && <em style={skillRoleTagStyle(skill.role)}>{skill.role}</em>}
                            </span>
                            <small>{skill.brief || '无描述'}</small>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className={styles.dropdownContainer}>
                    <button disabled={isInputLocked} type="button">
                      <i className="ri-tools-line"></i> 工具
                    </button>
                    <div className={styles.dropdown}>
                      <div className={styles.dropdownContent}>
                        {NATIVE_TOOLS.map((tool) => (
                          <div key={tool.id} className={styles.dropdownItem} style={{ cursor: 'default' }}>
                            <span>
                              <i className="ri-terminal-box-line"></i> {tool.id}
                            </span>
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
                    type="button"
                    title={isStreaming ? '停止' : '发送'}
                    aria-label={isStreaming ? '停止' : '发送'}
                    onClick={() => {
                      if (isStreaming) {
                        abortReasonRef.current = 'manual';
                        abortControllerRef.current?.abort();
                        return;
                      }
                      handleSend();
                    }}
                    disabled={isInputLocked && !isStreaming}
                  >
                    {isStreaming ? <i className="ri-stop-circle-line"></i> : <i className="ri-send-plane-fill"></i>}
                  </button>
                </div>
              </div>
            </div>
            <div className={styles.inputFooter}>企业级 Agent 平台由底座提供支持。内容由 AI 生成，请注意甄别。</div>
          </div>
        </>
      )}
    </div>
  );
}
