# MediaPipe Pose Integration Plan

## 文件
1. `src/utils/poseEngine.ts` — 初始化 PoseLandmarker，封装检测调用
2. `src/utils/poseRules.ts` — 规则引擎：骨骼点 → 关节角 → Marker[]
3. `CameraStream.tsx` — 集成 poseEngine，每帧运行规则，传递 landmarks
4. `App.tsx` — landmarks 流转 + prompt 增强

## 步骤
- [x] 安装 @mediapipe/tasks-vision
- [ ] 创建 poseEngine.ts — 加载模型，检测单帧
- [ ] 创建 poseRules.ts — 膝角/肘角/重心 规则 + 输出 Marker[]
- [ ] CameraStream.tsx — 初始化 poseEngine，每帧跑 pose + rules
- [ ] App.tsx — 集成 landmarks 到 handleFrame + AI prompt
- [ ] 构建验证

## 当前进度
正在执行: 更新 CameraStream — 集成 poseEngine + poseRules
