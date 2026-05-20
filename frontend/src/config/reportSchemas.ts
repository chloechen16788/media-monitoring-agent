export interface ChartSchema {
  chart_title: string;
  sampling_key: string;
}

export interface EntityBinding {
  description: string;
  applicable_charts: ChartSchema[];
}

export interface ReportSchema {
  entity_routing_version: string;
  report_type: string;
  report_name: string;
  entities: Record<string, EntityBinding>;
}

export const REPORT_SCHEMAS: Record<string, ReportSchema> = {
  brand_monthly: {
    entity_routing_version: "1.0",
    report_type: "brand_monthly",
    report_name: "品牌月报",
    entities: {
      brand: {
        description: "品牌整体舆情分析",
        applicable_charts: [
          { chart_title: "数据汇总", sampling_key: "summary_top_risks" },
          { chart_title: "情感声量占比", sampling_key: "sentiment_cluster_topn" },
          { chart_title: "情感声量趋势分析", sampling_key: "trend_peak_events" },
          { chart_title: "媒体类型声量趋势分析", sampling_key: "trend_by_media_type" },
          { chart_title: "媒体分布", sampling_key: "dimension_topn" },
          { chart_title: "热点媒体", sampling_key: "source_topn" },
          { chart_title: "意见领袖观点分析", sampling_key: "leader_top_posts" }
        ]
      },
      product: {
        description: "产品线舆情与用户口碑分析",
        applicable_charts: [
          { chart_title: "数据汇总", sampling_key: "summary_top_risks" },
          { chart_title: "情感声量趋势分析", sampling_key: "trend_peak_events" },
          { chart_title: "媒体分布", sampling_key: "dimension_topn" },
          { chart_title: "功能口碑分析", sampling_key: "dimension_topn" }
        ]
      },
      leader: {
        description: "领导人舆情形象与媒体表现分析",
        applicable_charts: [
          { chart_title: "数据汇总", sampling_key: "summary_top_risks" },
          { chart_title: "情感声量占比", sampling_key: "sentiment_cluster_topn" },
          { chart_title: "媒体类型声量趋势分析", sampling_key: "trend_by_media_type" },
          { chart_title: "意见领袖观点分析", sampling_key: "leader_top_posts" }
        ]
      }
    }
  }
};
