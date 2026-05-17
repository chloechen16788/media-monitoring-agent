import React, { useState } from 'react';
import styles from './Login.module.css';

interface LoginProps {
  onLogin: (userId: string) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [userId, setUserId] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (userId.trim()) {
      onLogin(userId.trim());
    }
  };

  return (
    <div className={styles.loginContainer}>
      <div className={styles.loginCard}>
        <h2>欢迎来到 企业智能体</h2>
        <p>请输入您的工号进入系统</p>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="例如: 1001"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className={styles.input}
            autoFocus
          />
          <button type="submit" className={styles.button}>
            进入系统
          </button>
        </form>
      </div>
    </div>
  );
}
