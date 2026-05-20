# 视频上传分析功能 ✅ 已完成

## 目标
新增"上传视频 → 自动抽帧分析 → 生成报告"功能，与现有"实时摄像头"模式并行。

## 改动清单

### 1. ✅ 新建 `src/components/VideoAnalysis.tsx`
自包含组件，覆盖完整流程：
- 文件选择器（accept video/*）
- 隐藏 `<video>` + `<canvas>` 播放和截帧
- 每 3s 截一帧 POST `/api/analyze`
- 进度条显示进度
- 视频结束后自动调 `/api/report`
- 复用现有的 `ReportView` 展示报告

### 2. ✅ 修改 `src/App.tsx`
- 新增 `mode` 状态：`'camera' | 'video'`
- 顶部模式切换按钮组（实时/视频）
- camera 模式渲染现有 CameraStream + 录制流程
- video 模式渲染 VideoAnalysis
- 录制按钮和底部信息在 video 模式隐藏

### 3. 不修改文件
- types.ts（复用现有类型）
- API 函数（analyze / report / jwt 不动）
- ReportView（直接复用）

## 流程
```
选择视频 → 开始分析 → 视频播放 + 每 3s 截帧 → POST /api/analyze → 攒 history
→ 视频结束 → POST /api/report → 显示 ReportView（含关键帧快照）
```

## 注意事项
- 帧间隔 3s（避免限流）
- 单帧失败不影响整体
- 视频结束或手动停止 → 生成报告
- 与实时模式共用同一套 API
- 视频在浏览器端处理，不上传到服务器
