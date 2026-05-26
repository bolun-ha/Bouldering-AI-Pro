# 实时模式 3 阶段实现计划

## 目标
在 CameraStream 实时模式下加入：
- Phase 1: 卡关检测 + 文字提示（纯 MediaPipe 规则引擎）
- Phase 2: 卡关触发 → 截帧送 5v → 弹文字 Beta
- Phase 3: 掉落自动复盘（分析报告自动弹出）

## 架构方案

```
CameraStream 检测循环
  ├─ 持续更新帧缓冲区（最新 ~5s/6帧 + 骨骼数据）
  ├─ 持续追踪髋部 Y 轴位移 → 卡关状态机
  ├─ 持续追踪髋部 Y 轴 + 姿态丢失 → 掉落检测
  ├─ 卡关触发 → 调 5v → onBeta callback
  └─ 掉落触发 → 调完整分析 → onAnalysis callback

App.tsx
  ├─ onBeta → 浮层显示 Beta 文字
  └─ onAnalysis → 弹出分析报告
```

## 改动文件

### 1. src/components/CameraStream.tsx (核心改动)
- 新增帧缓冲区: `frameBufferRef` — 存储 { canvas, timestamp, poseSnapshot, handSnapshot }
- 新增状态机: 追踪 hip center Y 位移
- 卡关检测: Y 位移 < 1% 持续 3s → stuck
- 掉落检测: Y 快速下降 (>20% in 500ms) + 姿态丢失 → fall
- 新 callback: `onStuck(frames)`, `onFall(frames)`

### 2. src/App.tsx (Wiring)
- 新增 `handleStuck` → 帧送 5v → 弹 Beta 浮层
- 新增 `handleFall` → 帧送全部析 → 弹出报告
- 显示 Beta 浮层组件

### 3. 新文件: 无, 复用现有 GuidancePanel + VideoAnalysis

## 执行步骤
1. CameraStream: 添加帧缓冲区
2. CameraStream: 添加卡关检测状态机
3. CameraStream: 添加掉落检测
4. CameraStream: 暴露 onStuck/onFall callbacks
5. App.tsx: 处理 stuck → 5v 分析
6. App.tsx: 处理 fall → 自动分析报告
7. 构建 → 推送 → ECS 部署测试
