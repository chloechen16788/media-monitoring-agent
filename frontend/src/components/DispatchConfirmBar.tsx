import React from 'react';
import styles from './DispatchConfirmBar.module.css';

interface DispatchConfirmBarProps {
  goal?: string;
  onExecute: () => void;
  onLater: () => void;
}

const DispatchConfirmBar: React.FC<DispatchConfirmBarProps> = ({
  goal,
  onExecute,
  onLater,
}) => {
  return (
    <div className={styles.bar}>
      <i className={`ri-checkbox-circle-line ${styles.icon}`} />
      <div className={styles.body}>
        <div className={styles.message}>Master 规划完成，确认后交给 Sub 开始执行</div>
        {goal && <div className={styles.meta}>目标：{goal}</div>}
        <div className={styles.actions}>
          <button className={styles.btnExecute} onClick={onExecute}>
            <i className="ri-play-circle-fill" />
            开始执行
          </button>
          <button className={styles.btnLater} onClick={onLater}>
            <i className="ri-time-line" />
            稍后
          </button>
        </div>
      </div>
      <button className={styles.dismiss} onClick={onLater} title="稍后确认">
        <i className="ri-close-line" />
      </button>
    </div>
  );
};

export default DispatchConfirmBar;
