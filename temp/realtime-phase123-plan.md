# 实时模式 3 阶段实现计划

## 目标
已在 CameraStream 实时模式下加入：
- Phase 1: 卡关检测 + 文字提示（纯 MediaPipe 规则引擎）
- Phase 2: 卡关触发 → 截帧送 5v → 弹文字 Beta
- Phase 3: 掉落自动复盘（分析报告自动弹出）

## 已实现 ✅

### CameraStream.tsx
- 帧缓冲区（FrameBufferEntry[]），连续保存最近 8 秒/6 帧 + 骨骼数据
- 髋部 Y 轴持续追踪（calcHipCenterY）
- 卡关状态机：Y 位移 < 0.8% 持续 3 秒 → stuck triggered（15 秒冷却防重复）
- 掉落检测：Y 快速下降 >15% 或 姿态丢失 + 向下趋势 → fall triggered
- 新 callback: `onStuck(buffer)`, `onFall(buffer)`

### App.tsx
- handleStuck → 取缓冲区内最近 4 帧 → 调 5v 简短 Beta prompt → 弹出浮层（8 秒消失）
- handleFall → 停止录制 → 弹出报告
- 卡关 Beta 浮层 UI（橙色渐变卡片，底部居中）

## 待部署
- ECS 需 `npm run build && pm2 restart`
