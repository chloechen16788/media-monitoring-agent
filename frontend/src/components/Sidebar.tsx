import { useEffect, useRef, useState } from 'react';
import styles from './Sidebar.module.css';
import AgentPromptEditor from './AgentPromptEditor';

interface Session {
  session_id: string;
  title: string;
  created_at: string;
}

interface Project {
  project_id: string;
  name: string;
}

interface SidebarProps {
  userId: string;
  currentProjectId: string | null;
  currentSessionId: string | null;
  onSelectProject: (projectId: string) => void;
  onSelectSession: (id: string) => void;
  taskContract?: any;
  onOpenPlan?: () => void;
  devVisible?: boolean;
  onToggleDev?: () => void;
  sessionRefreshSignal?: number;
}

const PLAN_STATUS_LABELS: Record<string, string> = {
  planned: '待确认',
  executing: '执行中',
  validating: '待验收',
  completed: '已完成',
  failed: '已失败',
};

export default function Sidebar({
  userId,
  currentProjectId,
  currentSessionId,
  onSelectProject,
  onSelectSession,
  taskContract,
  onOpenPlan,
  devVisible = false,
  onToggleDev,
  sessionRefreshSignal,
}: SidebarProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const eggClickCountRef = useRef(0);
  const eggTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchProjects = async () => {
    try {
      const res = await fetch(`http://localhost:3000/api/projects?userId=${encodeURIComponent(userId)}`, {
        headers: { 'x-user-id': userId },
      });
      const data = await res.json();
      if (!Array.isArray(data)) return;
      setProjects(data);
      if (!currentProjectId && data.length > 0) {
        onSelectProject(data[0].project_id);
      }
    } catch (err) {
      console.error('Failed to fetch projects', err);
    }
  };

  const fetchSessions = async () => {
    if (!currentProjectId) {
      setSessions([]);
      return;
    }
    try {
      const res = await fetch(
        `http://localhost:3000/api/sessions?userId=${encodeURIComponent(
          userId
        )}&projectId=${encodeURIComponent(currentProjectId)}`
      );
      const data = await res.json();
      if (Array.isArray(data)) {
        setSessions(data);
      }
    } catch (err) {
      console.error("Failed to fetch sessions", err);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, [userId]);

  useEffect(() => {
    fetchSessions();
  }, [userId, currentProjectId]);

  useEffect(() => {
    if (sessionRefreshSignal !== undefined && sessionRefreshSignal > 0) {
      fetchSessions();
    }
  }, [sessionRefreshSignal]);

  const handleCreateSession = async () => {
    try {
      const payload: Record<string, string> = { userId };
      if (currentProjectId) {
        payload.projectId = currentProjectId;
      }
      const res = await fetch(`http://localhost:3000/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.session_id) {
        if (data.project_id) {
          onSelectProject(data.project_id);
        }
        await fetchProjects();
        await fetchSessions();
        onSelectSession(data.session_id);
      }
    } catch (err) {
      console.error("Failed to create session", err);
    }
  };

  const handleLogoClick = () => {
    eggClickCountRef.current += 1;
    if (eggTimerRef.current) clearTimeout(eggTimerRef.current);
    if (eggClickCountRef.current >= 3) {
      eggClickCountRef.current = 0;
      onToggleDev?.();
    } else {
      eggTimerRef.current = setTimeout(() => {
        eggClickCountRef.current = 0;
      }, 800);
    }
  };

  const handleCreateProject = async () => {
    const name = prompt('请输入项目名称', '新项目');
    if (!name) return;
    try {
      const res = await fetch(`http://localhost:3000/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify({ userId, name }),
      });
      const data = await res.json();
      if (data.project_id) {
        await fetchProjects();
        onSelectProject(data.project_id);
      }
    } catch (err) {
      console.error('Failed to create project', err);
    }
  };

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <div className={styles.logo} onClick={handleLogoClick} style={{ cursor: 'default', userSelect: 'none' }}>
          <i className="ri-robot-2-line"></i>
          <span>CMM Agent</span>
        </div>
        <button className={styles.newChatBtn} onClick={handleCreateSession}>
          <i className="ri-add-line"></i> 新建聊天
        </button>
        {devVisible && (
          <button className={styles.newChatBtn} onClick={handleCreateProject}>
            <i className="ri-folder-add-line"></i> 新建项目
          </button>
        )}
        {devVisible && (
          <select
            className={styles.projectSelect}
            value={currentProjectId || ''}
            onChange={(e) => onSelectProject(e.target.value)}
          >
            {projects.length === 0 && <option value="">请先创建项目或直接新建聊天</option>}
            {projects.map((p) => (
              <option key={p.project_id} value={p.project_id}>
                {p.name} ({p.project_id})
              </option>
            ))}
          </select>
        )}
      </div>
      
      <div className={styles.sessionList}>
        <div className={styles.sectionTitle}>历史记录</div>
        {sessions.map(s => (
          <div 
            key={s.session_id} 
            className={`${styles.sessionItem} ${s.session_id === currentSessionId ? styles.active : ''}`}
            onClick={() => onSelectSession(s.session_id)}
          >
            <i className="ri-chat-3-line"></i>
            <span className={styles.sessionTitle}>{s.title}</span>
          </div>
        ))}
      </div>
      
      <div className={styles.footer}>
        {devVisible && taskContract?.goal ? (
          <div
            className={styles.planCard}
            onClick={onOpenPlan}
            title="点击在右侧查看完整计划"
          >
            <div className={styles.planHeader}>
              <i className="ri-draft-line"></i>
              <span className={styles.planTitle}>当前计划</span>
              <span
                className={`${styles.planStatus} ${
                  styles[`planStatus_${String(taskContract.status || 'planned')}`] || ''
                }`}
              >
                {PLAN_STATUS_LABELS[String(taskContract.status || 'planned')] ||
                  taskContract.status}
              </span>
            </div>
            <div className={styles.planGoal}>{taskContract.goal}</div>
            <div className={styles.planMeta}>
              {(taskContract.allowed_skills || []).length} 个技能 ·{' '}
              {(taskContract.acceptance_criteria || []).length} 条验收标准
            </div>
          </div>
        ) : null}
        <div className={styles.userProfile}>
          <i className="ri-user-smile-line"></i>
          <span>{userId}</span>
        </div>
        {devVisible && <AgentPromptEditor userId={userId} />}
      </div>
    </div>
  );
}
