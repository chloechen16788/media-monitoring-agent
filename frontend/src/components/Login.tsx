import React, { useState } from 'react';
import styles from './Login.module.css';
import { apiUrl, setAuthToken } from '../config/api';

interface LoginProps {
  onLogin: (userId: string) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const uid = userId.trim();
    if (!uid) {
      setError('请输入工号');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(apiUrl('/api/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: uid, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || '登录失败');
        return;
      }
      setAuthToken(data.token);
      onLogin(data.userId || uid);
    } catch (err) {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.loginContainer}>
      <div className={styles.loginCard}>
        <h2>欢迎来到 企业智能体</h2>
        <p>请输入工号与访问密码进入系统</p>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="工号，例如: 1001 或 cmm"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className={styles.input}
            autoFocus
          />
          <input
            type="password"
            placeholder="访问密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={styles.input}
          />
          {error && (
            <div style={{ color: '#e5484d', fontSize: 13, margin: '4px 0 8px' }}>{error}</div>
          )}
          <button type="submit" className={styles.button} disabled={loading}>
            {loading ? '登录中…' : '进入系统'}
          </button>
        </form>
      </div>
    </div>
  );
}
