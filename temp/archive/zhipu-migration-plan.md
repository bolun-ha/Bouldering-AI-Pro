# 迁移到智谱 API 执行计划

创建时间: 2026-05-19 17:47

## 目标

1. 分析模型从 Gemini 3 Flash → **GLM-4.6V-Flash**
2. TTS 从浏览器 SpeechSynthesis → **GLM-4-Voice**
3. 增加 AI 攀爬报告生成

## 步骤

- [x] 步骤1: `package.json` — 移除 `@google/genai`，清理依赖
- [x] 步骤2: `.env.example` + `vite.config.ts` — 更新环境变量名
- [x] 步骤3: `server.ts` — 重写 API（分析→Zhipu, TTS→Zhipu, 报告生成）
- [x] 步骤4: `src/types.ts` — 新增 ReportData 类型
- [x] 步骤5: `src/components/GuidancePanel.tsx` — 服务器 TTS 替换浏览器 TTS
- [x] 步骤6: `src/components/ReportView.tsx` — 接入 AI 报告
- [ ] 步骤7: 验证编译

## 当前进度

正在执行: 步骤7
