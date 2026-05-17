import React, { useEffect, useState } from 'react';
import styles from './Sidebar.module.css';

interface Session {
  session_id: string;
  title: string;
  created_at: string;
}

interface SidebarProps {
  userId: string;
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
}

export default function Sidebar({ userId, currentSessionId, onSelectSession }: SidebarProps) {
  const [sessions, setSessions] = useState<Session[]>([]);

  const fetchSessions = async () => {
    try {
      const res = await fetch(`http://localhost:3000/api/sessions?userId=${userId}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setSessions(data);
      }
    } catch (err) {
      console.error("Failed to fetch sessions", err);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, [userId]);

  const handleCreateSession = async () => {
    const title = prompt("请输入新会话标题", "新会话");
    if (!title) return;
    try {
      const res = await fetch(`http://localhost:3000/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, title })
      });
      const data = await res.json();
      if (data.session_id) {
        await fetchSessions();
        onSelectSession(data.session_id);
      }
    } catch (err) {
      console.error("Failed to create session", err);
    }
  };

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <div className={styles.logo}>
          <i className="ri-robot-2-line"></i>
          <span>Enterprise Agent</span>
        </div>
        <button className={styles.newChatBtn} onClick={handleCreateSession}>
          <i className="ri-add-line"></i> 新建聊天
        </button>
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
        <div className={styles.userProfile}>
          <i className="ri-user-smile-line"></i>
          <span>{userId}</span>
        </div>
      </div>
    </div>
  );
}
