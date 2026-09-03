import { useEffect, useState } from 'react';
import styles from './AgentPromptEditor.module.css';
import { apiUrl } from '../config/api';

type AgentRole = 'master' | 'sub';

interface AgentPromptEditorProps {
  userId: string;
}

export default function AgentPromptEditor({ userId }: AgentPromptEditorProps) {
  const [role, setRole] = useState<AgentRole>('master');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string>('');

  const fetchPrompt = async (targetRole: AgentRole) => {
    setLoading(true);
    setStatus('');
    try {
      const res = await fetch(
        apiUrl(`/api/agents/${targetRole}/system-prompt?userId=${encodeURIComponent(userId)}`),
        { headers: { 'x-user-id': userId } }
      );
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error || '加载失败');
        return;
      }
      setContent(data.content || '');
    } catch (e) {
      setStatus('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPrompt(role);
  }, [role, userId]);

  const handleSave = async () => {
    if (!content.trim()) {
      setStatus('Prompt 不能为空');
      return;
    }
    setSaving(true);
    setStatus('');
    try {
      const res = await fetch(apiUrl(`/api/agents/${role}/system-prompt`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify({ userId, content }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error || '保存失败');
        return;
      }
      setStatus('保存成功，下一次聊天自动生效');
    } catch (e) {
      setStatus('保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.editor}>
      <div className={styles.header}>
        <span>Agent Prompt</span>
        <select value={role} onChange={(e) => setRole(e.target.value as AgentRole)}>
          <option value="master">master</option>
          <option value="sub">sub</option>
        </select>
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="在这里编辑系统提示词"
        rows={8}
        disabled={loading || saving}
      />
      <button type="button" onClick={handleSave} disabled={loading || saving}>
        {saving ? '保存中...' : '保存 Prompt'}
      </button>
      {status && <div className={styles.status}>{status}</div>}
    </div>
  );
}
