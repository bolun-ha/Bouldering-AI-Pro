# 视频录制 + AI 标注功能 执行计划

创建时间: 2026-05-19 17:39

## 目标

为 Bouldering AI Pro 添加视频录制功能：攀爬过程中录制带 AI 标注的视频，并在报告页中回放和导出。

## 步骤

- [x] 步骤1: `src/types.ts` — 添加 HistoryEntry 类型，更新 SessionData
- [x] 步骤2: `src/components/CameraStream.tsx` — 暴露 video 元素引用
- [x] 步骤3: `src/components/VideoRecorder.tsx` — 新建录制合成组件（核心）
- [x] 步骤4: `src/App.tsx` — 串联录制流程
- [x] 步骤5: `src/components/ReportView.tsx` — 视频回放 + 下载 + 快照画廊
- [ ] 步骤3: `src/components/VideoRecorder.tsx` — 新建录制合成组件（核心）
- [ ] 步骤4: `src/App.tsx` — 串联录制流程
- [ ] 步骤5: `src/components/ReportView.tsx` — 视频回放 + 下载

## 当前进度

正在执行: 步骤1
