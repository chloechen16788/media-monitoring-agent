import React from 'react';
import styles from './SkillFallbackBar.module.css';

export interface SkillFallbackPayload {
  message: string;
  missing_skills?: string[];
  context?: string;
}

interface SkillFallbackBarProps {
  payload: SkillFallbackPayload;
  onSwitchMaster: (context: string) => void;
  onContinue: () => void;
  onDismiss: () => void;
}

const SkillFallbackBar: React.FC<SkillFallbackBarProps> = ({
  payload,
  onSwitchMaster,
  onContinue,
  onDismiss,
}) => {
  const missingLabel = payload.missing_skills?.join('、') ?? '';
  const context = payload.context ?? payload.message ?? '';

  return (
    <div className={styles.bar}>
      <i className={`ri-error-warning-line ${styles.icon}`} />
      <div className={styles.body}>
        <div className={styles.message}>
          {payload.message}
          {missingLabel && (
            <span style={{ marginLeft: 6, opacity: 0.75 }}>（需要：{missingLabel}）</span>
          )}
        </div>
        <div className={styles.actions}>
          <button
            className={styles.btnMaster}
            onClick={() => onSwitchMaster(context)}
          >
            <i className="ri-git-branch-line" />
            切回 Master 更新计划
          </button>
          <button
            className={styles.btnContinue}
            onClick={onContinue}
          >
            <i className="ri-play-circle-line" />
            用现有技能继续执行
          </button>
        </div>
      </div>
      <button className={styles.dismiss} onClick={onDismiss} title="关闭提示">
        <i className="ri-close-line" />
      </button>
    </div>
  );
};

export default SkillFallbackBar;
