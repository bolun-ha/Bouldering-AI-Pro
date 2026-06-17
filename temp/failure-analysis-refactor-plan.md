# 实时模式报告重构：buffer帧快速失败分析

## 目标
将报告生成从「seek 录制视频抽帧 → /api/report」改为「取 buffer 最后 5 帧 → /api/analyze-failure」

## 步骤

- [x] Phase 1: server.ts — 新增 `/api/analyze-failure` 端点
- [ ] Phase 2: App.tsx — 存储 buffer 帧 + 停止原因，透传到 ReportView
- [ ] Phase 3: ReportView.tsx — 删除 extractFramesFromVideo，改调 /api/analyze-failure
- [ ] Phase 4: 构建 + 部署 v50
