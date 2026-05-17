import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './RightSidebar.module.css';

interface RightSidebarProps {
  citationText: string;
  onClose: () => void;
}

export default function RightSidebar({ citationText, onClose }: RightSidebarProps) {
  return (
    <div className={styles.rightSidebar}>
      <div className={styles.header}>
        <h3>溯源详情</h3>
        <button onClick={onClose} className={styles.closeBtn}>
          <i className="ri-close-line"></i>
        </button>
      </div>
      <div className={styles.content}>
        <div className={styles.citationCard}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{citationText}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
