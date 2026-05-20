# Hand Tracking (MediaPipe Hands) + Hold Position Detection Plan

## 文件
1. `src/types.ts` — 新增 `HoldPosition` 类型 + `AnalysisResult.hold_positions`
2. `src/utils/poseEngine.ts` — 添加 HandLandmarker 初始化 + 检测函数
3. `src/utils/handRules.ts` — 手指关节角 → 抓握类型识别
4. `src/components/CameraStream.tsx` — 集成 hand 检测 + 骨骼数据传入
5. `src/App.tsx` — 处理 holdPositions 合并标记
6. `netlify/functions/_shared.mjs` — prompt 要求输出 hold_positions
7. `netlify/functions/analyze.mjs` + `server.ts` — 传入 hand 数据

## 步骤
- [x] 更新类型
- [x] poseEngine.ts — 加 HandLandmarker + 抓握类型 + 岩点距离计算
- [x] 创建 handRules.ts → 集成到 poseEngine.ts（无需单独文件）
- [x] CameraStream — 集成 hand 检测
- [x] App.tsx — holdPositions 处理 + hand 数据传递
- [x] prompt 更新 + analyze 端点 + server.ts

## 当前进度
已全部完成，准备推送
