import styles from './TaskBoard.module.css';

interface TaskBoardProps {
  contract: any;
  agentMode: 'master' | 'sub';
  onDispatchToSub?: () => void;
  onValidate?: (result: 'completed' | 'failed') => void;
}

function resolveStatus(contract: any): 'planned' | 'executing' | 'validating' | 'completed' | 'failed' {
  const status = String(contract?.status || '').toLowerCase();
  if (['planned', 'executing', 'validating', 'completed', 'failed'].includes(status)) {
    return status as 'planned' | 'executing' | 'validating' | 'completed' | 'failed';
  }
  if (!contract?.goal) return 'planned';
  if (Array.isArray(contract?.acceptance_criteria) && contract.acceptance_criteria.length > 0) {
    return 'validating';
  }
  if (Array.isArray(contract?.allowed_skills) && contract.allowed_skills.length > 0) {
    return 'executing';
  }
  return 'planned';
}

export default function TaskBoard({ contract, agentMode, onDispatchToSub, onValidate }: TaskBoardProps) {
  const status = resolveStatus(contract || {});
  const columns = [
    { key: 'planned', title: '计划' },
    { key: 'executing', title: '执行中' },
    { key: 'validating', title: '验收中' },
    { key: 'completed', title: status === 'failed' ? '失败' : '完成' },
  ];

  return (
    <div className={styles.taskBoard}>
      <div className={styles.summary}>
        <span>当前模式：{agentMode.toUpperCase()}</span>
        <span>任务ID：{contract?.task_id || '-'}</span>
      </div>
      {agentMode === 'master' && status === 'planned' && onDispatchToSub && (
        <button className={styles.dispatchBtn} type="button" onClick={onDispatchToSub}>
          交给 Sub 执行
        </button>
      )}
      {agentMode === 'master' && status === 'validating' && onValidate && (
        <div className={styles.validateRow}>
          <button className={styles.passBtn} type="button" onClick={() => onValidate('completed')}>
            验收通过
          </button>
          <button className={styles.rejectBtn} type="button" onClick={() => onValidate('failed')}>
            驳回
          </button>
        </div>
      )}
      <div className={styles.columns}>
        {columns.map((column) => {
          const active =
            status === column.key || (status === 'failed' && column.key === 'completed');
          return (
            <div key={column.key} className={`${styles.column} ${active ? styles.active : ''}`}>
              <h4>{column.title}</h4>
              {active ? (
                <div className={styles.card}>
                  <div className={styles.label}>目标</div>
                  <div>{contract?.goal || '待设置任务目标'}</div>
                  <div className={styles.label}>允许技能</div>
                  <div>{Array.isArray(contract?.allowed_skills) && contract.allowed_skills.length > 0 ? contract.allowed_skills.join(', ') : '未配置'}</div>
                </div>
              ) : (
                <div className={styles.placeholder}>等待流转</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
