# 重写计划：buffer 帧快速失败分析

- [x] Phase 1: server.ts — 新增 `/api/analyze-failure` 端点
- [x] Phase 2: App.tsx — 存 buffer + reason，透传至 ReportView
- [x] Phase 3: ReportView.tsx — 删除 extractFramesFromVideo + 旧 report UI，改为调用 /api/analyze-failure + 简洁分析卡
- [x] Phase 4: 构建+部署 v50 (PID 904029)

## 改动总结

### 删除
- ❌ `extractFramesFromVideo()` 整段（~130 行）
- ❌ `reportProgress` 三阶段进度条
- ❌ `framesLoading` / `framesProgress` 状态
- ❌ `/api/report` 调用
- ❌ 旧报告 UI（overallScore、strengths、weaknesses、improvements、trend）

### 新增
- ✅ `server.ts`: `/api/analyze-failure` POST 端点，接收 `bufferFrames + reason + history`，返回 `{ cause, analysis, suggestion, advice }`
- ✅ `App.tsx`: `lastBufferFramesRef` + `stopReasonRef`，handleFall 存 buffer
- ✅ `ReportView.tsx`: 新 `FailureAnalysis` 类型 + 新 loading + 简洁分析卡展示
