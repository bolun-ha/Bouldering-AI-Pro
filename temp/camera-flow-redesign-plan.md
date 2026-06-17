# 实时模式流程重构 执行计划

## 目标
将实时模式拆成 4 个清晰状态，修复底部分析位置错误，增加"打开镜头"预览模式

## 状态机
```
cameraStarted=false         // 摄像头硬件开关
isRecording=false           // 录制+AI分析开关
showReport=false            // 报告显示

新流程：
  主页(camera off) → 打开镜头 → 预览(pose+三角) → 开始攀爬 → 录制(pose+AI+录像) → 结束攀爬 → 报告 → 继续攀爬 → 预览(pose+三角)
```

## 改动文件

### 1. App.tsx
- `startClimb()` 不再设 cameraStarted=true（由"打开镜头"控制）
- `stopClimb()` 新增 setCameraStarted(false)（关闭摄像头）
- `onReset()` 新增 setCameraStarted(true)（回到预览态）
- 新增"打开镜头"按钮（cameraStarted=false 时显示）
- "开始攀爬"按钮只在 cameraStarted=true 时显示
- CameraStream 传 poseActive={cameraStarted}

### 2. CameraStream.tsx
- 新增 poseActive prop
- 新增 poseActiveRef
- change: isRecordingRef.current → isRecordingRef.current || poseActiveRef.current
