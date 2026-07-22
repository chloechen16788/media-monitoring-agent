import { useEffect, useRef, useState } from 'react';
import './App.css';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import RightSidebar from './components/RightSidebar';
import Login from './components/Login';
import { apiUrl } from './config/api';
interface RightPanelConfig {
  mode: 'citation' | 'workspace' | 'tasks';
  data: string | any;
}

type AgentMode = 'master' | 'sub';

function resolveAgentMode(state: any, contract: any): AgentMode {
  const status = String(contract?.status || 'planned').toLowerCase();
  if (status === 'executing' && state?.active_agent === 'sub') {
    return 'sub';
  }
  return 'master';
}

function App() {
  const [userId, setUserId] = useState<string | null>(null);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [rightPanel, setRightPanel] = useState<RightPanelConfig | null>(null);
  const [customInsights, setCustomInsights] = useState<Record<string, string>>({});
  const [agentMode, setAgentMode] = useState<AgentMode>('master');
  const [taskContract, setTaskContract] = useState<any>(null);
  const [subDispatchSignal, setSubDispatchSignal] = useState(0);
  const [devVisible, setDevVisible] = useState(false);
  const [sessionRefreshSignal, setSessionRefreshSignal] = useState(0);
  // 手动锁定模式：用户一旦手动切到某个 Agent，运行时刷新就不再用自动判定覆盖它，
  // 直到用户切回另一模式或切换项目/会话（重新规划上下文）。用 ref 同步读取避免闭包取到旧值。
  const manualModeRef = useRef<AgentMode | null>(null);
  const lockManualMode = (mode: AgentMode | null) => {
    manualModeRef.current = mode;
  };

  const refreshProjectRuntimeState = async (targetProjectId: string) => {
    if (!userId || !targetProjectId) return;
    try {
      const [agentRes, contractRes] = await Promise.all([
        fetch(
          apiUrl(
            `/api/projects/${encodeURIComponent(targetProjectId)}/agent-state?userId=${encodeURIComponent(
              userId
            )}`
          ),
          { headers: { 'x-user-id': userId } }
        ),
        fetch(
          apiUrl(
            `/api/projects/${encodeURIComponent(targetProjectId)}/task-contract?userId=${encodeURIComponent(
              userId
            )}`
          ),
          { headers: { 'x-user-id': userId } }
        ),
      ]);
      const state = agentRes.ok ? await agentRes.json() : { active_agent: 'master' };
      const contract = contractRes.ok ? await contractRes.json() : null;
      // 手动锁定优先：后端每次 Sub 执行结束会强制把 active_agent 翻回 master，
      // 若用户手动锁定了模式，前端必须无视该自动判定，保持用户选择。
      const effectiveMode = manualModeRef.current ?? resolveAgentMode(state, contract);
      setAgentMode(effectiveMode);
      if (contract) {
        setTaskContract(contract);
        if (rightPanel?.mode === 'tasks') {
          setRightPanel({
            mode: 'tasks',
            data: {
              contract,
              agentMode: effectiveMode,
              onDispatchToSub: handleDispatchToSub,
              onValidate: handleValidate,
            },
          });
        }
      }
    } catch (e) {
      console.error('Failed to refresh project runtime state', e);
    }
  };

  useEffect(() => {
    if (!userId || !currentProjectId) return;
    refreshProjectRuntimeState(currentProjectId);
  }, [userId, currentProjectId]);

  if (!userId) {
    return <Login onLogin={setUserId} />;
  }

  const handleShowCitation = (text: string) => {
    setRightPanel({ mode: 'citation', data: text });
  };

  const handleOpenWorkspace = (config: any) => {
    setRightPanel({ mode: 'workspace', data: config });
  };

  const handleUpdateInsight = (target: string, text: string) => {
    setCustomInsights(prev => ({ ...prev, [target]: text }));
  };

  const handleChangeAgentMode = async (mode: AgentMode): Promise<boolean> => {
    if (!userId || !currentProjectId) return false;
    try {
      const res = await fetch(
        apiUrl(`/api/projects/${encodeURIComponent(currentProjectId)}/agent-state`),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
          body: JSON.stringify({ userId, active_agent: mode }),
        }
      );
      if (!res.ok) return false;
      // 用户/流程显式切换即视为手动锁定，后续刷新不再被自动判定弹回。
      lockManualMode(mode);
      setAgentMode(mode);
      if (rightPanel?.mode === 'tasks') {
        setRightPanel({
          mode: 'tasks',
          data: { contract: taskContract, agentMode: mode, onDispatchToSub: handleDispatchToSub, onValidate: handleValidate },
        });
      }
      return true;
    } catch (e) {
      console.error('Failed to update agent mode', e);
      return false;
    }
  };

  const handleOpenTaskBoard = async () => {
    if (!currentProjectId || !userId) return;
    try {
      const [agentRes, contractRes] = await Promise.all([
        fetch(
          apiUrl(
            `/api/projects/${encodeURIComponent(currentProjectId)}/agent-state?userId=${encodeURIComponent(
              userId
            )}`
          ),
          { headers: { 'x-user-id': userId } }
        ),
        fetch(
          apiUrl(
            `/api/projects/${encodeURIComponent(currentProjectId)}/task-contract?userId=${encodeURIComponent(
              userId
            )}`
          ),
          { headers: { 'x-user-id': userId } }
        ),
      ]);
      const state = agentRes.ok ? await agentRes.json() : { active_agent: agentMode };
      const contract = contractRes.ok ? await contractRes.json() : taskContract;
      const effectiveMode = manualModeRef.current ?? resolveAgentMode(state, contract);
      setTaskContract(contract);
      setAgentMode(effectiveMode);
      setRightPanel({
        mode: 'tasks',
        data: {
          contract,
          agentMode: effectiveMode,
          onDispatchToSub: handleDispatchToSub,
          onValidate: handleValidate,
        },
      });
    } catch (e) {
      console.error('Failed to open task board', e);
    }
  };

  const handleDispatchToSub = async () => {
    if (!currentProjectId || !userId) return;
    const switched = await handleChangeAgentMode('sub');
    if (!switched) return;
    try {
      const contractRes = await fetch(
        apiUrl(
          `/api/projects/${encodeURIComponent(currentProjectId)}/task-contract?userId=${encodeURIComponent(userId)}`
        ),
        { headers: { 'x-user-id': userId } }
      );
      const contract = contractRes.ok ? await contractRes.json() : null;
      if (contract) {
        const status = String(contract.status || 'planned').toLowerCase();
        const canPromote = status === 'planned' || status === 'failed';
        const allowedSkills = Array.isArray(contract.allowed_skills) ? contract.allowed_skills : [];
        if (canPromote && allowedSkills.length > 0) {
          const setExecutingRes = await fetch(
            apiUrl(`/api/projects/${encodeURIComponent(currentProjectId)}/task-contract`),
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
              body: JSON.stringify({
                userId,
                contract: { ...contract, status: 'executing' },
              }),
            }
          );
          if (setExecutingRes.ok) {
            const updated = await setExecutingRes.json();
            if (updated?.contract) setTaskContract(updated.contract);
          }
        }
      }
    } catch (e) {
      console.error('Failed to promote task contract to executing', e);
    }
    setSubDispatchSignal((prev) => prev + 1);
  };

  const handleValidate = async (result: 'completed' | 'failed') => {
    if (!currentProjectId || !userId) return;
    try {
      const res = await fetch(
        apiUrl(`/api/projects/${encodeURIComponent(currentProjectId)}/task-contract`),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
          body: JSON.stringify({
            userId,
            contract: { ...(taskContract || {}), status: result },
          }),
        }
      );
      if (!res.ok) return;
      const data = await res.json();
      const updated = data.contract || { ...(taskContract || {}), status: result };
      setTaskContract(updated);
      // 验收后回到 Master 视角
      await handleChangeAgentMode('master');
      setRightPanel({
        mode: 'tasks',
        data: {
          contract: updated,
          agentMode: 'master',
          onDispatchToSub: handleDispatchToSub,
          onValidate: handleValidate,
        },
      });
    } catch (e) {
      console.error('Failed to validate task contract', e);
    }
  };

  const handleProjectChange = (projectId: string) => {
    // 切项目 = 全新上下文，解除手动锁定，模式回到自动判定。
    lockManualMode(null);
    setCurrentProjectId(projectId);
    setCurrentSessionId(null);
    setSubDispatchSignal(0);
  };

  const handleSelectSession = (sessionId: string) => {
    // 切/建会话 = 重新规划上下文，解除手动锁定后再按后端真实状态刷新。
    lockManualMode(null);
    setCurrentSessionId(sessionId);
    setSubDispatchSignal(0);
    // 会话切换/新建时同步服务端运行时状态：
    // 新建会话时后端已把 agent_state 重置为 master，前端必须跟随刷新，
    // 否则会沿用上一轮残留的 sub 模式，导致新对话直接进入 Sub 执行旧契约。
    if (currentProjectId) {
      refreshProjectRuntimeState(currentProjectId);
    }
  };

  return (
    <div className="app-container">
      <Sidebar 
        userId={userId} 
        currentProjectId={currentProjectId}
        currentSessionId={currentSessionId} 
        onSelectProject={handleProjectChange}
        onSelectSession={handleSelectSession} 
        taskContract={taskContract}
        onOpenPlan={handleOpenTaskBoard}
        devVisible={devVisible}
        onToggleDev={() => setDevVisible(v => !v)}
        sessionRefreshSignal={sessionRefreshSignal}
      />
      <ChatArea 
        userId={userId} 
        projectId={currentProjectId}
        currentSessionId={currentSessionId} 
        agentMode={agentMode}
        onChangeAgentMode={handleChangeAgentMode}
        onShowCitation={handleShowCitation}
        onOpenTaskBoard={handleOpenTaskBoard}
        onOpenWorkspace={handleOpenWorkspace}
        onUpdateInsight={handleUpdateInsight}
        onTaskContractChanged={() => {
          if (currentProjectId) {
            refreshProjectRuntimeState(currentProjectId);
          }
        }}
        subDispatchSignal={subDispatchSignal}
        devVisible={devVisible}
        onSessionTitleUpdated={() => setSessionRefreshSignal(s => s + 1)}
      />
      {rightPanel && (
        <RightSidebar 
          config={rightPanel} 
          customInsights={customInsights}
          onClose={() => setRightPanel(null)} 
        />
      )}
    </div>
  );
}

export default App;
