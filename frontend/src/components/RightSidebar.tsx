import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ReactECharts from 'echarts-for-react';
import styles from './RightSidebar.module.css';
import { REPORT_SCHEMAS, type ChartSchema } from '../config/reportSchemas';
import CHART_RENDER_SCHEMA from '../../../skills/chart_render_schema.json';

interface RightSidebarProps {
  config: any;
  customInsights?: Record<string, string>;
  onClose?: () => void;
}

const TASK_MAP: Record<string, string> = {
  "t_bmw": "6860", "t_benz": "6861", "t_audi": "6862", "t_mini": "6863"
};

export default function RightSidebar({ config, customInsights = {}, onClose }: RightSidebarProps) {
  if (config.mode === 'citation') {
    return (
      <div className={styles.rightSidebar}>
        <div className={styles.header}>
          <h3>溯源详情</h3>
          <button onClick={onClose} className={styles.closeBtn}><i className="ri-close-line"></i></button>
        </div>
        <div className={styles.content}>
          <div className={styles.citationCard}><ReactMarkdown remarkPlugins={[remarkGfm]}>{config.data}</ReactMarkdown></div>
        </div>
      </div>
    );
  }

  const { reportType, schemaKey, entityTasks, dateRange, esData } = config.data || {};
  const isDynamic = reportType === 'dynamic_schema';
  const schema = isDynamic ? REPORT_SCHEMAS[schemaKey] : null;

  // Typewriter effect component
  const TypewriterText = ({ text, delay }: { text: string, delay: number }) => {
    const [displayed, setDisplayed] = useState('');
    useEffect(() => {
      let i = 0;
      setDisplayed('');
      const intId = setInterval(() => {
        setDisplayed(text.substring(0, i));
        i++;
        if (i > text.length) clearInterval(intId);
      }, delay);
      return () => clearInterval(intId);
    }, [text, delay]);
    return <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayed}</ReactMarkdown>;
  };

  const getAggData = (field: string) => esData?.agg_data?.aggs?.[field] || {};

  // Dynamic Chart Renderer
  const renderDynamicChart = (chart: ChartSchema, entityKey: string, tasks: any[]) => {
    const targetSlotId = `${entityKey}_${chart.sampling_key}`;
    const insightText = customInsights[targetSlotId];
    
    // Dynamically retrieve render config from SCHEMA
    const renderConfig = (CHART_RENDER_SCHEMA.charts as any)[chart.sampling_key];
    let opt: any = {};
    const t = tasks[0];
    const tid = t ? TASK_MAP[t.id] : null;
    
    if (!renderConfig) {
      opt = {
        xAxis: { type: 'category', data: ['A','B','C'] },
        yAxis: { type: 'value' },
        series: [{ type: 'bar', data: [10,20,30] }]
      };
    } else {
      const data = getAggData(renderConfig.dataSourceField)[tid || ""] || [];
      const slicedData = renderConfig.chartType === 'pie' ? data : data.slice(0, 10);
      
      const { nameKey, valueKey } = renderConfig.mapping;
      const names = slicedData.length > 0 ? slicedData.map((d: any) => d[nameKey] || '未知') : ['无数据'];
      const values = slicedData.length > 0 ? slicedData.map((d: any) => d[valueKey] || 0) : [0];
      
      const baseOpt: any = { ...renderConfig.styleOption };
      
      if (renderConfig.chartType === 'pie') {
        const pieData = slicedData.length > 0 ? slicedData.map((d: any) => ({ name: d[nameKey], value: d[valueKey] })) : [{name: '无数据', value: 0}];
        baseOpt.series = [{ type: 'pie', data: pieData, ...(renderConfig.styleOption?.seriesParams || {}) }];
      } else {
        if (renderConfig.styleOption?.isCategoryY) {
          baseOpt.yAxis = { type: 'category', data: names };
          if (!baseOpt.xAxis) baseOpt.xAxis = { type: 'value' };
        } else {
          baseOpt.xAxis = { type: 'category', data: names };
          if (!baseOpt.yAxis) baseOpt.yAxis = { type: 'value' };
        }
        baseOpt.series = [{ type: renderConfig.chartType, data: values, ...(renderConfig.styleOption?.seriesParams || {}) }];
      }
      
      // Clean up custom params
      delete baseOpt.seriesParams;
      delete baseOpt.isCategoryY;
      opt = baseOpt;
    }

    return (
      <div key={targetSlotId} className={styles.reportSection}>
        <h3>{chart.chart_title}</h3>
        <div className={styles.interactiveChartArea}>
          <ReactECharts option={opt} style={{ height: '300px', width: '100%' }} />
        </div>
        <div className={styles.llmInsight} style={insightText ? { backgroundColor: '#f0f5ff', borderColor: '#adc6ff' } : {}}>
          <strong><i className={insightText ? "ri-sparkling-fill" : "ri-robot-2-fill"}></i> {insightText ? "AI 定制分析" : "AI 智能洞察"}：</strong>
          <p><TypewriterText text={insightText || `[插槽 ID: ${targetSlotId}] 请在左侧通过工具箱或自然语言召唤大模型进行深度分析并投射至此。`} delay={25} /></p>
        </div>
      </div>
    );
  };

  return (
    <div className={`${styles.rightSidebar} ${styles.canvasSidebar}`}>
      <div className={styles.header}>
        <h3><i className="ri-layout-grid-fill"></i> 智能报告大屏</h3>
        <button onClick={onClose} className={styles.closeBtn}><i className="ri-close-line"></i></button>
      </div>
      
      <div className={styles.canvasContent}>
        {isDynamic && schema ? (
          <>
            <div className={styles.reportHeader}>
              <h2>{schema.report_name} 动态声量全景报告</h2>
              <p className={styles.reportMeta}>Schema: {schemaKey} | 真实 ES 引擎动态抽取</p>
            </div>

            {!esData ? (
              <div style={{padding: 20, textAlign: 'center'}}>正在拉取底层数据，请稍候...</div>
            ) : (
              Object.keys(schema.entities).map(entityKey => {
                const entityConfig = schema.entities[entityKey];
                const tasks = entityTasks[entityKey] || [];
                if (tasks.length === 0) return null;
                
                return (
                  <div key={entityKey} className={styles.categorySuperSection}>
                    <div className={styles.categoryTitleBanner}>
                      <i className="ri-folder-chart-line"></i> 视角：{entityConfig.description} ({tasks.map((t: any) => t.name).join(', ')})
                    </div>
                    {entityConfig.applicable_charts.map(chart => renderDynamicChart(chart, entityKey, tasks))}
                  </div>
                );
              })
            )}
          </>
        ) : (
          <div style={{padding: 20, textAlign: 'center', color: '#888'}}>
            <p>非动态 Schema 模式。大屏正在升级中，请在左侧使用“高级报告配置”面板选择 Schema 模板生成。</p>
          </div>
        )}

        <div className={styles.reportFooter}>
          <button className={styles.exportBtn}><i className="ri-download-cloud-2-line"></i> 导出为 PDF</button>
          <button className={styles.exportBtn}><i className="ri-share-line"></i> 分享报告链接</button>
        </div>
      </div>
    </div>
  );
}
