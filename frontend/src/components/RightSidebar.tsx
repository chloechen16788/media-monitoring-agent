import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ReactECharts from 'echarts-for-react';
import styles from './RightSidebar.module.css';

interface RightSidebarProps {
  config: { mode: 'citation' | 'workspace'; data: any; dateRange?: string; esData?: any };
  customInsights?: Record<string, string>;
  onClose: () => void;
}

const TypewriterText = ({ text, delay = 30 }: { text: string, delay?: number }) => {
  const [displayedText, setDisplayedText] = useState('');
  useEffect(() => {
    let i = 0;
    setDisplayedText('');
    const timer = setInterval(() => {
      if (i < text.length) {
        setDisplayedText(prev => prev + text.charAt(i));
        i++;
      } else {
        clearInterval(timer);
      }
    }, delay);
    return () => clearInterval(timer);
  }, [text, delay]);
  return <span>{displayedText}</span>;
};

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

  const esData = config.data?.esData;
  const categories = config.data?.data || []; // The categories array from frontend

  // Helper to extract data for a chart
  const getAggData = (field: string) => esData?.agg_data?.aggs?.[field] || {};

  const renderSov = (tasks: any[]) => {
    const sovData = getAggData('sov');
    return (
      <div className={styles.reportSection}>
        <h3>声量与 SOV 份额对比</h3>
        <div className={styles.metricsGrid}>
          {tasks.map(t => {
            const tid = TASK_MAP[t.id];
            const d = sovData.find((x: any) => String(x.task_id) === String(tid));
            return (
              <div key={t.id} className={styles.metricCard}>
                <div className={styles.metricLabel}>{t.name} 总声量</div>
                <div className={styles.metricValue}>{d ? d.doc_count.toLocaleString() : '0'} <span className={styles.up}></span></div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderTrend = (tasks: any[]) => {
    const trendAgg = getAggData('trend');
    const datesSet = new Set<string>();
    
    // Collect all unique dates
    tasks.forEach(t => {
      const tid = TASK_MAP[t.id];
      const data = trendAgg[tid] || [];
      data.forEach((d: any) => datesSet.add(d.date));
    });
    const dates = Array.from(datesSet).sort();
    
    const series = tasks.map(t => {
      const tid = TASK_MAP[t.id];
      const data = trendAgg[tid] || [];
      const dataMap = Object.fromEntries(data.map((d: any) => [d.date, d.doc_count]));
      return {
        name: t.name,
        type: 'line',
        smooth: true,
        data: dates.map(date => dataMap[date] || 0)
      };
    });

    const opt = {
      tooltip: { trigger: 'axis' },
      legend: { data: tasks.map(t => t.name), bottom: 0 },
      grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: dates },
      yAxis: { type: 'value' },
      series
    };
    
    // Find highest peak for AI insight
    let maxDate = dates[0];
    let maxVal = 0;
    series.forEach(s => s.data.forEach((val, i) => { if (val > maxVal) { maxVal = val; maxDate = dates[i]; } }));

    return (
      <div className={styles.reportSection}>
        <h3>多品牌声量交锋趋势分析</h3>
        <div className={styles.interactiveChartArea}><ReactECharts option={opt} style={{ height: '350px', width: '100%' }} /></div>
        <div className={styles.llmInsight} style={customInsights['d_trend'] ? { backgroundColor: '#f0f5ff', borderColor: '#adc6ff' } : {}}>
          <strong><i className={customInsights['d_trend'] ? "ri-sparkling-fill" : "ri-robot-2-fill"}></i> {customInsights['d_trend'] ? "AI 定制分析" : "AI 智能洞察"}：</strong>
          <p><TypewriterText text={customInsights['d_trend'] || `已为您绘制各品牌趋势对比数据。如需对波峰节点进行深层归因分析，请在左侧对话框随时下达指令，例如：“调用 tools 帮我详细解读一下刚才趋势图中的波峰事件。”`} delay={25} /></p>
        </div>
      </div>
    );
  };

  const renderChannel = (tasks: any[]) => {
    const channelAgg = getAggData('channel');
    // Using first task as representative for pie chart, or combine them
    const t = tasks[0];
    if (!t) return null;
    const tid = TASK_MAP[t.id];
    const data = channelAgg[tid] || [];
    
    const opt = {
      tooltip: { trigger: 'item' },
      legend: { top: '5%', left: 'center' },
      series: [{
        name: '声量分布', type: 'pie', radius: ['40%', '70%'],
        itemStyle: { borderRadius: 10, borderColor: '#fff', borderWidth: 2 },
        label: { show: false, position: 'center' },
        emphasis: { label: { show: true, fontSize: '20', fontWeight: 'bold' } },
        data: data.map((d: any) => ({ name: d.channel_name, value: d.doc_count }))
      }]
    };
    
    const topChannel = data.length > 0 ? data.sort((a: any, b: any) => b.doc_count - a.doc_count)[0].channel_name : '未知';

    return (
      <div className={styles.reportSection}>
        <h3>受众渠道分布 (以 {t.name} 为例)</h3>
        <div className={styles.interactiveChartArea}><ReactECharts option={opt} style={{ height: '350px', width: '100%' }} /></div>
        <div className={styles.llmInsight} style={customInsights['d_channel'] ? { backgroundColor: '#f0f5ff', borderColor: '#adc6ff' } : {}}>
          <strong><i className={customInsights['d_channel'] ? "ri-sparkling-fill" : "ri-robot-2-fill"}></i> {customInsights['d_channel'] ? "AI 定制分析" : "AI 智能洞察"}：</strong>
          <p><TypewriterText text={customInsights['d_channel'] || `全渠道分布数据如上。如果您需要分析更微观的平台受众特征，可以在左侧随时让大模型通过 tools 为您获取。`} delay={25} /></p>
        </div>
      </div>
    );
  };

  const renderSentiment = (tasks: any[]) => {
    const sentimentAgg = getAggData('sentiment');
    const sentiments = ['正面', '中性', '负面'];
    
    const series = sentiments.map(sent => ({
      name: sent,
      type: 'bar',
      stack: 'total',
      label: { show: true },
      data: tasks.map(t => {
        const tid = TASK_MAP[t.id];
        const data = sentimentAgg[tid] || [];
        const match = data.find((d: any) => d.sentiment_name === sent);
        return match ? match.doc_count : 0;
      }),
      itemStyle: { color: sent === '正面' ? '#52c41a' : (sent === '中性' ? '#bfbfbf' : '#ff4d4f') }
    }));

    const opt = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { data: sentiments, bottom: 0 },
      grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
      xAxis: { type: 'value' },
      yAxis: { type: 'category', data: tasks.map(t => t.name) },
      series
    };

    return (
      <div className={styles.reportSection}>
        <h3>品牌情感倾向对标</h3>
        <div className={styles.interactiveChartArea}><ReactECharts option={opt} style={{ height: '300px', width: '100%' }} /></div>
      </div>
    );
  };

  const renderPrnDistribution = (tasks: any[]) => {
    const prnAgg = getAggData('prn_distribution');
    const t = tasks[0];
    if (!t) return null;
    const tid = TASK_MAP[t.id];
    const data = prnAgg[tid] || [];
    
    const opt = {
      tooltip: { trigger: 'item' },
      legend: { top: '5%', left: 'center' },
      series: [{
        name: '发稿类型', type: 'pie', radius: '50%',
        data: data.map((d: any) => ({ name: d.label, value: d.doc_count })),
        emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.5)' } }
      }]
    };

    return (
      <div className={styles.reportSection}>
        <h3>主动发稿与自然提及占比 (PRN - {t.name})</h3>
        <div className={styles.interactiveChartArea}><ReactECharts option={opt} style={{ height: '300px', width: '100%' }} /></div>
      </div>
    );
  };

  const renderTrendByChannel = (tasks: any[]) => {
    const trendChAgg = getAggData('trend_by_channel');
    const t = tasks[0];
    if (!t) return null;
    const tid = TASK_MAP[t.id];
    const daysData = trendChAgg[tid] || [];
    
    const dates = daysData.map((d: any) => d.date);
    // Gather all channels
    const channelsSet = new Set<string>();
    daysData.forEach((d: any) => d.channels.forEach((c: any) => channelsSet.add(c.channel)));
    const channels = Array.from(channelsSet);
    
    const series = channels.map(ch => {
      return {
        name: ch,
        type: 'bar',
        stack: 'total',
        data: daysData.map((d: any) => {
          const match = d.channels.find((c: any) => c.channel === ch);
          return match ? match.doc_count : 0;
        })
      };
    });

    const opt = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { data: channels, bottom: 0 },
      grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
      xAxis: { type: 'category', data: dates },
      yAxis: { type: 'value' },
      series
    };

    return (
      <div className={styles.reportSection}>
        <h3>各渠道时序趋势交锋 ({t.name})</h3>
        <div className={styles.interactiveChartArea}><ReactECharts option={opt} style={{ height: '350px', width: '100%' }} /></div>
        <div className={styles.llmInsight} style={customInsights['trend_by_channel'] ? { backgroundColor: '#f0f5ff', borderColor: '#adc6ff' } : {}}>
          <strong><i className={customInsights['trend_by_channel'] ? "ri-sparkling-fill" : "ri-magic-line"}></i> {customInsights['trend_by_channel'] ? "AI 定制分析" : "AI 智能洞察"}：</strong>
          <p><TypewriterText text={customInsights['trend_by_channel'] || `如需对该模块的异常波动、负面分布或渠道特征进行深层归因，请在左侧对话框随时下达指令，例如：“调用 tools 帮我详细解读一下刚才本品声量趋势中的波峰原因。” 大模型将自动调取底层明细数据为您专属解答。`} delay={25} /></p>
        </div>
      </div>
    );
  };

  const renderSources = (tasks: any[]) => {
    const sourcesAgg = getAggData('sources');
    const t = tasks[0];
    if (!t) return null;
    const tid = TASK_MAP[t.id];
    let data = sourcesAgg[tid] || [];
    data = [...data].sort((a: any, b: any) => a.total_prn - b.total_prn).slice(-10); // get top 10

    const opt = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: '3%', right: '4%', bottom: '5%', top: '5%', containLabel: true },
      xAxis: { type: 'value', name: '影响力(PRN)' },
      yAxis: { type: 'category', data: data.map((d: any) => d.media_name) },
      series: [{ name: '综合影响力', type: 'bar', data: data.map((d: any) => d.total_prn), itemStyle: { color: '#722ed1' } }]
    };

    return (
      <div className={styles.reportSection}>
        <h3>核心媒体与 KOL 影响力穿透</h3>
        <div className={styles.interactiveChartArea}><ReactECharts option={opt} style={{ height: '300px', width: '100%' }} /></div>
      </div>
    );
  };

  const renderSentimentCluster = () => {
    const negSample = esData?.negative_sample_data?.articles || [];
    return (
      <div className={styles.reportSection}>
        <h3>AI 核心负面危机预警</h3>
        <div className={styles.llmInsight} style={{ backgroundColor: '#fff1f0', borderColor: '#ffa39e' }}>
          <strong style={{ color: '#cf1322' }}><i className="ri-alarm-warning-fill"></i> AI 负面危机靶向排查 (基于 Finger 抽样数据)：</strong>
          <p style={{ color: '#cf1322', marginTop: 10 }}>
            {negSample.length > 0 ? (
              <>根据专属的 <code>sentiment: -1</code> 过滤层，系统揪出了最具破坏力的核心槽点源头：<br/><br/>
              <b>🚨 第一落点：</b>【{negSample[0].title}】<br/>(来自 {negSample[0].media}，相似报道波及 {negSample[0].fingerprint_cluster_size} 篇)。<br/><br/>
              <b>🚨 第二落点：</b>【{negSample[1]?.title || '无'}】。<br/>(波及 {negSample[1]?.fingerprint_cluster_size || 0} 篇)。<br/><br/>
              建议立即对上述源头执行封堵式 PR 策略。</>
            ) : (
              <TypewriterText text="当前未发现严重的聚集性负面事件，口碑防线稳固。" delay={25} />
            )}
          </p>
        </div>
      </div>
    );
  };

  const renderEffectMetrics = (tasks: any[]) => {
    const effectAgg = getAggData('effect_metrics');
    return (
      <div className={styles.reportSection}>
        <h3>触达与互动效果指标 (总览)</h3>
        <div className={styles.metricsGrid}>
          {tasks.map(t => {
            const tid = TASK_MAP[t.id];
            const d = effectAgg[tid];
            return (
              <React.Fragment key={t.id}>
                <div className={styles.metricCard}>
                  <div className={styles.metricLabel}>{t.name} 预估阅读量</div>
                  <div className={styles.metricValue}>{d ? d.total_reads_24h.toLocaleString() : '0'}</div>
                </div>
                <div className={styles.metricCard}>
                  <div className={styles.metricLabel}>{t.name} 总互动量</div>
                  <div className={styles.metricValue}>{d ? d.total_likes.toLocaleString() : '0'}</div>
                </div>
              </React.Fragment>
            );
          })}
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
        <div className={styles.reportHeader}>
          <h2>{categories[0]?.tasks?.[0]?.name?.split(' ')[0] || 'Manus 收购'} 动态声量全景报告</h2>
          <p className={styles.reportMeta}>基于 {categories.reduce((acc: number, c: any) => acc + c.tasks.length, 0)} 个分析视角 | 真实 ES 引擎动态抽取</p>
        </div>

        {!esData ? (
          <div style={{padding: 20, textAlign: 'center'}}>正在拉取底层数据，请稍候...</div>
        ) : (
          categories.map((cat: any) => (
            <div key={cat.id} className={styles.categorySuperSection}>
              <div className={styles.categoryTitleBanner}>
                <i className="ri-folder-chart-line"></i> 分析版块：{cat.name}
              </div>
              
              {cat.dimensions.map((dim: any) => (
                <div key={`${cat.id}_${dim.id}`}>
                  {dim.id === 'd_sov' && renderSov(cat.tasks)}
                  {dim.id === 'd_trend' && renderTrend(cat.tasks)}
                  {dim.id === 'd_channel' && renderChannel(cat.tasks)}
                  {dim.id === 'd_sentiment' && renderSentiment(cat.tasks)}
                  {dim.id === 'prn_distribution' && renderPrnDistribution(cat.tasks)}
                  {dim.id === 'trend_by_channel' && renderTrendByChannel(cat.tasks)}
                  {dim.id === 'source_topn' && renderSources(cat.tasks)}
                  {dim.id === 'sentiment_cluster_topn' && renderSentimentCluster()}
                  {dim.id === 'effect_metrics' && renderEffectMetrics(cat.tasks)}
                </div>
              ))}
            </div>
          ))
        )}

        <div className={styles.reportFooter}>
          <button className={styles.exportBtn}><i className="ri-download-cloud-2-line"></i> 导出为 PDF</button>
          <button className={styles.exportBtn}><i className="ri-share-line"></i> 分享报告链接</button>
        </div>
      </div>
    </div>
  );
}
