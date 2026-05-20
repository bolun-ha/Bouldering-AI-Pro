/** 生成自包含的 HTML 训练报告 */
import type { SessionData, ReportData } from '../types';

export function generateHtmlReport(
  session: SessionData,
  report: ReportData | null,
): string {
  const date = new Date(session.startTime);
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const duration = session.endTime
    ? Math.floor((session.endTime - session.startTime) / 1000)
    : Math.floor(session.history.length * 1.8);

  const score = report?.overallScore ?? 0;
  const scoreColor = score >= 70 ? '#10b981' : score >= 50 ? '#f97316' : '#ef4444';

  // 构建关键帧 HTML
  const snapshotsHtml = session.history
    .map((entry, i) => {
      if (!entry.snapshot) return '';
      const timeEstimate = Math.floor(i * 1.8);
      const statusMap: Record<string, string> = {
        moving: '移动中',
        steady: '姿势稳定',
        stuck: '停滞',
        falling: '坠落检测',
        finished: '完成',
      };
      return `
        <div class="snapshot-card">
          <img src="${entry.snapshot}" alt="关键帧 ${i + 1}" loading="lazy" />
          <div class="snapshot-meta">
            <span class="snapshot-num">#${(i + 1).toString().padStart(2, '0')}</span>
            <span>${timeEstimate}s</span>
            <span>${statusMap[entry.result.climb_status] || entry.result.climb_status}</span>
          </div>
          ${entry.result.instruction ? `<div class="snapshot-ins">${escapeHtml(entry.result.instruction)}</div>` : ''}
          <div class="snapshot-markers">${(() => {
            const errs = entry.result.markers.filter(m => m.type === 'error').length;
            const warns = entry.result.markers.filter(m => m.type === 'warning').length;
            const succs = entry.result.markers.filter(m => m.type === 'success').length;
            const parts = [];
            if (errs) parts.push(`<span class="mk-err">❌${errs}</span>`);
            if (warns) parts.push(`<span class="mk-warn">⚠️${warns}</span>`);
            if (succs) parts.push(`<span class="mk-succ">✅${succs}</span>`);
            return parts.join(' ') || '<span class="mk-none">无标记</span>';
          })()}</div>
          ${entry.result.detailed_feedback ? `<div class="snapshot-fb">${escapeHtml(entry.result.detailed_feedback)}</div>` : ''}
        </div>
      `;
    })
    .filter(Boolean)
    .join('\n');

  // 报告内容
  const reportHtml = report
    ? `
    <div class="section">
      <div class="section-title">📋 训练摘要</div>
      <p class="report-summary">${escapeHtml(report.summary)}</p>
    </div>

    ${report.strengths?.length ? `
    <div class="section">
      <div class="section-title">✅ 优点</div>
      <ul class="report-list report-list-strength">
        ${report.strengths.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
      </ul>
    </div>` : ''}

    ${report.weaknesses?.length ? `
    <div class="section">
      <div class="section-title">⚠️ 改进点</div>
      <ul class="report-list report-list-weak">
        ${report.weaknesses.map(w => `<li>${escapeHtml(w)}</li>`).join('')}
      </ul>
    </div>` : ''}

    ${report.improvements?.length ? `
    <div class="section">
      <div class="section-title">💡 改进建议</div>
      <ul class="report-list report-list-imp">
        ${report.improvements.map(imp => `<li>${escapeHtml(imp)}</li>`).join('')}
      </ul>
    </div>` : ''}

    ${report.trend ? `
    <div class="section">
      <div class="section-title">📈 趋势分析</div>
      <p class="report-trend">${escapeHtml(report.trend)}</p>
    </div>` : ''}`
    : '<p class="text-muted">AI 报告尚未生成</p>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI 抱石训练报告</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", sans-serif;
  background: #0f172a; color: #e2e8f0;
  padding: 24px 16px 60px;
  max-width: 800px; margin: 0 auto;
}
.header { text-align: center; margin-bottom: 32px; }
.logo {
  display: inline-flex; align-items: center; gap: 10px;
  background: #ea580c; color: #fff; padding: 8px 20px;
  border-radius: 12px; font-size: 20px; font-weight: 900;
  letter-spacing: -0.5px; margin-bottom: 12px;
}
.logo span { font-style: italic; }
.session-info { color: #64748b; font-size: 12px; letter-spacing: 2px; }
.score-ring {
  display: flex; flex-direction: column; align-items: center;
  margin: 24px 0;
}
.score-number {
  font-size: 64px; font-weight: 900; font-family: "SF Mono", monospace;
  color: ${scoreColor};
}
.score-label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 3px; margin-top: 2px; }
.stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 32px; }
.stat-card {
  background: #1e293b; border: 1px solid #334155; border-radius: 16px;
  padding: 16px; text-align: center;
}
.stat-value { font-size: 28px; font-weight: 900; font-family: "SF Mono", monospace; color: #f1f5f9; }
.stat-label { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 2px; margin-top: 4px; }
.section-title { font-size: 14px; font-weight: 800; color: #ea580c; margin-bottom: 12px; letter-spacing: 1px; text-transform: uppercase; }
.section { background: #1e293b; border: 1px solid #334155; border-radius: 20px; padding: 20px; margin-bottom: 16px; }
.report-summary { font-size: 16px; line-height: 1.7; color: #f1f5f9; }
.report-trend { font-size: 14px; line-height: 1.6; color: #94a3b8; font-style: italic; }
.report-list { list-style: none; display: flex; flex-direction: column; gap: 8px; }
.report-list li {
  padding: 12px 16px; border-radius: 12px; font-size: 14px; line-height: 1.5;
}
.report-list-strength li { background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.2); color: #a7f3d0; }
.report-list-weak li { background: rgba(251, 146, 60, 0.12); border: 1px solid rgba(251, 146, 60, 0.2); color: #fdba74; }
.report-list-imp li { background: rgba(59, 130, 246, 0.12); border: 1px solid rgba(59, 130, 246, 0.2); color: #bfdbfe; }
.text-muted { color: #64748b; font-size: 14px; text-align: center; padding: 20px; }
.snapshots-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
}
.snapshot-card {
  background: #1e293b; border: 1px solid #334155; border-radius: 16px; overflow: hidden;
}
.snapshot-card img { width: 100%; display: block; aspect-ratio: 16/9; object-fit: cover; }
.snapshot-meta {
  display: flex; gap: 8px; padding: 6px 10px;
  font-size: 10px; font-family: "SF Mono", monospace; color: #64748b;
  background: #0f172a;
}
.snapshot-num { color: #ea580c; font-weight: 700; }
.snapshot-markers { padding: 2px 10px; font-size: 10px; }
.snapshot-markers span { margin-right: 4px; }
.mk-err { color: #ef4444; }
.mk-warn { color: #f97316; }
.mk-succ { color: #10b981; }
.mk-none { color: #64748b; }
.snapshot-fb {
  padding: 6px 10px 10px; font-size: 12px; color: #94a3b8; line-height: 1.4;
}
.footer {
  text-align: center; margin-top: 40px; padding-top: 20px;
  border-top: 1px solid #1e293b;
  font-size: 10px; color: #334155; letter-spacing: 2px;
}
@media (max-width: 480px) {
  .stats { grid-template-columns: 1fr 1fr; }
  .snapshots-grid { grid-template-columns: 1fr; }
  .score-number { font-size: 48px; }
}
</style>
</head>
<body>
<div class="header">
  <div class="logo"><span>🧗 抱石 AI</span> 专业版</div>
  <div class="session-info">SESSION #${session.startTime.toString().slice(-6)} · ${dateStr}</div>
</div>

<div class="score-ring">
  <div class="score-number">${score}</div>
  <div class="score-label">综合评分</div>
</div>

<div class="stats">
  <div class="stat-card">
    <div class="stat-value">${duration}s</div>
    <div class="stat-label">攀爬时长</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${session.totalErrors}</div>
    <div class="stat-label">错误/建议</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${session.history.length}</div>
    <div class="stat-label">分析帧数</div>
  </div>
</div>

${reportHtml}

${snapshotsHtml ? `
<div class="section">
  <div class="section-title">📸 AI 标注关键帧</div>
  <div class="snapshots-grid">
    ${snapshotsHtml}
  </div>
</div>` : ''}

<div class="footer">
  Bouldering AI Systems · 由 GLM-4.6V-Flash 驱动<br>
  报告生成时间: ${new Date().toLocaleString('zh-CN')}
</div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
