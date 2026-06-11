import { useEffect, useMemo, useState } from 'react';
import styles from './ParamRequestBar.module.css';

export type ParamFieldType = 'text' | 'select' | 'date' | 'daterange';

export interface ParamRequestFieldOption {
  value: string;
  label: string;
}

export interface ParamRequestField {
  key: string;
  label: string;
  type: ParamFieldType;
  required?: boolean;
  placeholder?: string;
  pattern?: string;
  hint?: string;
  options?: ParamRequestFieldOption[];
  start_key?: string;
  end_key?: string;
}

export interface ParamRequestPayload {
  title?: string;
  fields: ParamRequestField[];
}

export interface DateRangeValue {
  start: string;
  end: string;
}

type ParamValue = string | DateRangeValue;

interface ParamRequestBarProps {
  request: ParamRequestPayload;
  values: Record<string, ParamValue | undefined>;
  errors: Record<string, string>;
  shakeToken: number;
  onChange: (fieldKey: string, value: ParamValue) => void;
  onSetError: (fieldKey: string, error: string) => void;
  validateField: (field: ParamRequestField, value: ParamValue | undefined) => string;
  onDismiss: () => void;
}

function isRangeValue(value: ParamValue | undefined): value is DateRangeValue {
  return Boolean(value && typeof value === 'object' && 'start' in value && 'end' in value);
}

function formatChipValue(field: ParamRequestField, value: ParamValue | undefined): string {
  if (value == null || value === '') return '';
  if (field.type === 'select') {
    const hit = field.options?.find((item) => item.value === value);
    return hit?.label || String(value);
  }
  if (field.type === 'daterange' && isRangeValue(value)) {
    if (!value.start && !value.end) return '';
    return `${value.start || '未选'} ~ ${value.end || '未选'}`;
  }
  return String(value);
}

export default function ParamRequestBar({
  request,
  values,
  errors,
  shakeToken,
  onChange,
  onSetError,
  validateField,
  onDismiss,
}: ParamRequestBarProps) {
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState('');
  const [dateDraft, setDateDraft] = useState('');
  const [rangeDraft, setRangeDraft] = useState<DateRangeValue>({ start: '', end: '' });
  const [shakeFieldKey, setShakeFieldKey] = useState<string | null>(null);

  const activeField = useMemo(
    () => request.fields.find((item) => item.key === activeFieldKey) || null,
    [request.fields, activeFieldKey]
  );

  useEffect(() => {
    if (!activeField) return;
    const current = values[activeField.key];
    if (activeField.type === 'text' || activeField.type === 'select') {
      setTextDraft(typeof current === 'string' ? current : '');
      return;
    }
    if (activeField.type === 'date') {
      setDateDraft(typeof current === 'string' ? current : '');
      return;
    }
    if (activeField.type === 'daterange') {
      if (isRangeValue(current)) {
        setRangeDraft({ start: current.start || '', end: current.end || '' });
      } else {
        setRangeDraft({ start: '', end: '' });
      }
    }
  }, [activeField, values]);

  useEffect(() => {
    if (!shakeToken || !request.fields.length) return;
    const firstMissing = request.fields.find((field) => {
      if (!field.required) return false;
      const value = values[field.key];
      return Boolean(validateField(field, value));
    });
    if (!firstMissing) return;
    setShakeFieldKey(firstMissing.key);
    const timer = window.setTimeout(() => setShakeFieldKey(null), 550);
    return () => window.clearTimeout(timer);
  }, [shakeToken, request.fields, values, validateField]);

  const commitTextField = () => {
    if (!activeField) return;
    const nextValue = textDraft.trim();
    const error = validateField(activeField, nextValue);
    onSetError(activeField.key, error);
    if (error) return;
    onChange(activeField.key, nextValue);
    setActiveFieldKey(null);
  };

  const commitDateField = () => {
    if (!activeField) return;
    const nextValue = dateDraft;
    const error = validateField(activeField, nextValue);
    onSetError(activeField.key, error);
    if (error) return;
    onChange(activeField.key, nextValue);
    setActiveFieldKey(null);
  };

  const commitRangeField = () => {
    if (!activeField) return;
    const nextValue: DateRangeValue = { start: rangeDraft.start, end: rangeDraft.end };
    const error = validateField(activeField, nextValue);
    onSetError(activeField.key, error);
    if (error) return;
    onChange(activeField.key, nextValue);
    setActiveFieldKey(null);
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.title}>{request.title || '请补充参数'}</span>
        <span className={styles.headerRight}>
          <span className={styles.subtitle}>点击灰框填写后发送</span>
          <button
            type="button"
            className={styles.dismissBtn}
            title="关闭参数输入，直接对话"
            onClick={onDismiss}
          >
            <i className="ri-close-line" />
          </button>
        </span>
      </div>

      <div className={styles.chips}>
        {request.fields.map((field) => {
          const value = values[field.key];
          const display = formatChipValue(field, value);
          const fieldError = errors[field.key];
          return (
            <button
              key={field.key}
              type="button"
              className={[
                styles.chip,
                display ? styles.filled : '',
                fieldError ? styles.error : '',
                shakeFieldKey === field.key ? styles.shake : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setActiveFieldKey(field.key)}
            >
              <span className={styles.chipLabel}>
                {field.label}
                {field.required ? <em className={styles.requiredDot} /> : null}
              </span>
              <span className={styles.chipValue}>{display || '待填写'}</span>
            </button>
          );
        })}
      </div>

      {activeField ? (
        <div className={styles.popover}>
          <div className={styles.popoverHeader}>
            <strong>{activeField.label}</strong>
            <button type="button" className={styles.closeBtn} onClick={() => setActiveFieldKey(null)}>
              <i className="ri-close-line" />
            </button>
          </div>

          {activeField.type === 'text' ? (
            <div className={styles.formRow}>
              <input
                className={styles.textInput}
                value={textDraft}
                onChange={(e) => {
                  setTextDraft(e.target.value);
                  if (errors[activeField.key]) onSetError(activeField.key, '');
                }}
                placeholder={activeField.placeholder || '请输入'}
              />
              <button type="button" className={styles.confirmBtn} onClick={commitTextField}>
                确认
              </button>
            </div>
          ) : null}

          {activeField.type === 'select' ? (
            <div className={styles.optionList}>
              {(activeField.options || []).map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={styles.optionItem}
                  onClick={() => {
                    onSetError(activeField.key, '');
                    onChange(activeField.key, item.value);
                    setActiveFieldKey(null);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}

          {activeField.type === 'date' ? (
            <div className={styles.formRow}>
              <input
                className={styles.dateInput}
                type="date"
                value={dateDraft}
                onChange={(e) => {
                  setDateDraft(e.target.value);
                  if (errors[activeField.key]) onSetError(activeField.key, '');
                }}
              />
              <button type="button" className={styles.confirmBtn} onClick={commitDateField}>
                确认
              </button>
            </div>
          ) : null}

          {activeField.type === 'daterange' ? (
            <div className={styles.rangePanel}>
              <div className={styles.rangeInputs}>
                <input
                  className={styles.dateInput}
                  type="date"
                  value={rangeDraft.start}
                  onChange={(e) => {
                    setRangeDraft((prev) => ({ ...prev, start: e.target.value }));
                    if (errors[activeField.key]) onSetError(activeField.key, '');
                  }}
                />
                <span className={styles.rangeSep}>到</span>
                <input
                  className={styles.dateInput}
                  type="date"
                  value={rangeDraft.end}
                  onChange={(e) => {
                    setRangeDraft((prev) => ({ ...prev, end: e.target.value }));
                    if (errors[activeField.key]) onSetError(activeField.key, '');
                  }}
                />
              </div>
              <button type="button" className={styles.confirmBtn} onClick={commitRangeField}>
                确认时间段
              </button>
            </div>
          ) : null}

          {errors[activeField.key] ? <div className={styles.errorText}>{errors[activeField.key]}</div> : null}
          {!errors[activeField.key] && activeField.hint ? (
            <div className={styles.hintText}>{activeField.hint}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
