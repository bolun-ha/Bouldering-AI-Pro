import React, { useRef, useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { SessionData, ReportData } from '../types';
import {
  Trophy, Clock, Target, AlertTriangle, Loader2,
  ChevronRight, Share2, Play, Download, Camera, Video, Pause, Sparkles, TrendingUp, Lightbulb, ListChecks
} from 'lucide-react';

interface ReportViewProps {
  data: SessionData;
  recordedVideo: Blob | null;
  onReset: () => void;
}

export const ReportView: React.FC<ReportViewProps> = ({ data, recordedVideo, onReset }) => {
  const duration = data.endTime ? Math.floor((data.endTime - data.startTime) / 1000) : 0;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTab, setActiveTab] = useState<'video' | 'snapshots'>('video');
  const [report, setReport] = useState<ReportData | null>(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [reportError, setReportError] = useState<string | null>(null);

  // 录制视频 URL（用 ref 避免重复创建导致对象泄漏）
  const videoUrlRef = useRef<string | null>(null);
  if (recordedVideo && !videoUrlRef.current) {
    videoUrlRef.current = URL.createObjectURL(recordedVideo);
  }

  // ─── AI 报告生成 ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function fetchReport() {
      setReportLoading(true);
      setReportError(null);
      try {
        const historyData = data.history.map((entry) => ({
          instruction: entry.result.instruction,
          detailed_feedback: entry.result.detailed_feedback,
          climb_status: entry.result.climb_status,
          detected_route_color: entry.result.detected_route_color,
          markers: entry.result.markers.map(m => ({
            type: m.type,
            label: m.label,
            description: m.description,
          })),
        }));

        const response = await fetch('/api/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            history: historyData,
            totalErrors: data.totalErrors,
            duration,
          }),
        });

        if (!response.ok) throw new Error(`生成报告失败 (${response.status})`);

        const result: ReportData = await response.json();
        if (!cancelled) setReport(result);
      } catch (err: any) {
        if (!cancelled) setReportError(err.message || '生成报告失败');
      } finally {
        if (!cancelled) setReportLoading(false);
      }
    }

    fetchReport();
    return () => { cancelled = true; };
  }, [data, duration]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const downloadVideo = () => {
    if (!recordedVideo || !videoUrlRef.current) return;
    const a = document.createElement('a');
    a.href = videoUrlRef.current;
    a.download = `攀爬记录-${new Date(data.startTime).toLocaleDateString()}.webm`;
    a.click();
  };

  const downloadSnapshot = (snapshot: string, index: number) => {
    const a = document.createElement('a');
    a.href = snapshot;
    a.download = `关键帧-${index + 1}.jpg`;
    a.click();
  };

  // 清理 URL 对象
  useEffect(() => {
    return () => {
      if (videoUrlRef.current) {
        URL.revokeObjectURL(videoUrlRef.current);
        videoUrlRef.current = null;
      }
    };
  }, [recordedVideo]);

  return (
    <div className="fixed inset-0 bg-slate-950 z-50 overflow-y-auto px-6 py-12 text-slate-200 font-sans">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-xl mx-auto"
      >
        {/* Header */}
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-3xl font-black tracking-tighter text-white uppercase italic">攀爬 <span className="text-orange-500">训练报告</span></h1>
            <p className="text-slate-500 font-mono text-[10px] uppercase tracking-[0.3em] mt-1">SESSION: #{data.startTime.toString().slice(-6)}</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 px-4 py-2 rounded-xl min-w-[72px] text-center">
             <span className="text-[10px] text-slate-500 block uppercase font-bold tracking-widest">评分</span>
             {reportLoading ? (
               <Loader2 className="w-5 h-5 text-emerald-400 animate-spin mx-auto mt-1" />
             ) : report ? (
               <span className={`text-xl font-mono ${(report.overallScore || 0) >= 70 ? 'text-emerald-400' : (report.overallScore || 0) >= 50 ? 'text-orange-400' : 'text-red-400'}`}>
                 {report.overallScore}
               </span>
             ) : (
               <span className="text-xl font-mono text-slate-600">--</span>
             )}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl">
            <div className="flex items-center gap-2 text-slate-500 mb-2">
              <Clock className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest">攀爬时长</span>
            </div>
            <div className="text-2xl font-mono text-white">{duration}秒</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl">
            <div className="flex items-center gap-2 text-slate-500 mb-2">
              <AlertTriangle className="w-4 h-4 text-orange-500" />
              <span className="text-[10px] font-bold uppercase tracking-widest">错误/建议</span>
            </div>
            <div className="text-2xl font-mono text-orange-500">{data.totalErrors}</div>
          </div>
        </div>

        {/* ========= 录制回放区域 ========= */}
        {recordedVideo && (
          <div className="mb-8">
            {/* Tab Switcher */}
            <div className="flex gap-1 bg-slate-900 rounded-2xl p-1 mb-4">
              <button
                onClick={() => setActiveTab('video')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${
                  activeTab === 'video'
                    ? 'bg-orange-600 text-white shadow-lg'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Video className="w-4 h-4" />
                视频回放
              </button>
              <button
                onClick={() => setActiveTab('snapshots')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${
                  activeTab === 'snapshots'
                    ? 'bg-orange-600 text-white shadow-lg'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Camera className="w-4 h-4" />
                关键帧
              </button>
            </div>

            {/* Video Playback Tab */}
            {activeTab === 'video' && (
              <div className="bg-slate-900 border border-slate-800 rounded-[40px] overflow-hidden">
                <div className="relative bg-black aspect-video">
                  <video
                    ref={videoRef}
                    src={videoUrlRef.current!}
                    className="w-full h-full object-contain"
                    playsInline
                    onEnded={() => setIsPlaying(false)}
                    onPause={() => setIsPlaying(false)}
                    onPlay={() => setIsPlaying(true)}
                  />
                  <button
                    onClick={togglePlay}
                    className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/10 transition-colors group"
                  >
                    <div className={`w-16 h-16 rounded-full bg-white/90 flex items-center justify-center transition-all ${
                      isPlaying ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'
                    }`}>
                      {isPlaying ? (
                        <Pause className="w-7 h-7 text-slate-950 fill-current ml-0.5" />
                      ) : (
                        <Play className="w-7 h-7 text-slate-950 fill-current ml-1" />
                      )}
                    </div>
                  </button>
                  <div className="absolute top-3 left-3 bg-slate-950/70 backdrop-blur-sm px-2.5 py-1 rounded-full text-[9px] font-mono text-orange-400 uppercase tracking-widest">
                    AI 标注视频
                  </div>
                  <div className="absolute bottom-3 right-3 bg-slate-950/70 backdrop-blur-sm px-2.5 py-1 rounded-full text-[10px] font-mono text-slate-300">
                    {duration}秒
                  </div>
                </div>
                <div className="p-4 flex gap-3">
                  <button
                    onClick={downloadVideo}
                    className="flex-1 bg-slate-800 hover:bg-slate-700 py-3 rounded-2xl flex items-center justify-center gap-2 text-sm font-bold transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    下载视频 (.webm)
                  </button>
                </div>
              </div>
            )}

            {/* Snapshots Gallery Tab */}
            {activeTab === 'snapshots' && (
              <div className="bg-slate-900 border border-slate-800 rounded-[40px] p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-bold text-orange-500 uppercase tracking-[0.2em]">
                    AI 分析关键帧
                  </h3>
                  <span className="text-[10px] font-mono text-slate-500">
                    {data.history.length} 帧
                  </span>
                </div>

                {data.history.length === 0 ? (
                  <p className="text-slate-500 text-sm italic text-center py-8">
                    未检测到攀爬数据
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {data.history.map((entry, idx) => (
                      <div
                        key={idx}
                        className="relative group rounded-2xl overflow-hidden bg-slate-800 aspect-video"
                      >
                        {entry.snapshot ? (
                          <img
                            src={entry.snapshot}
                            alt={`帧 ${idx + 1}`}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-600">
                            <Camera className="w-8 h-8" />
                          </div>
                        )}

                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                          <span className="text-[9px] font-mono text-orange-400 uppercase tracking-wider">
                            #{(idx + 1).toString().padStart(2, '0')} · {Math.floor(idx * 1.8)}s
                          </span>
                          <span className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">
                            {entry.result.detected_route_color && `线路: ${entry.result.detected_route_color}`}
                            {entry.result.detected_route_color && ' · '}
                            {entry.result.climb_status === 'moving' ? '移动中' :
                             entry.result.climb_status === 'steady' ? '稳定' :
                             entry.result.climb_status === 'stuck' ? '停滞' :
                             entry.result.climb_status === 'falling' ? '坠落' : '完成'}
                          </span>
                          <button
                            onClick={() => entry.snapshot && downloadSnapshot(entry.snapshot, idx)}
                            className="mt-1 text-[9px] text-slate-300 underline underline-offset-2 hover:text-white transition-colors flex items-center gap-1"
                          >
                            <Download className="w-3 h-3" />
                            导出截图
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ─── AI 生成报告详情 ─────────────────────────────────────── */}
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-[40px] mb-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-5">
            <Sparkles className="w-24 h-24 text-white" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-6">
              <Sparkles className="w-4 h-4 text-orange-500" />
              <h3 className="text-xs font-bold text-orange-500 uppercase tracking-[0.2em]">
                AI 智能分析报告
                {reportLoading && (
                  <span className="ml-2 text-slate-500 font-normal normal-case tracking-normal">
                    (生成中...)
                  </span>
                )}
              </h3>
            </div>

            {reportLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <Loader2 className="w-8 h-8 text-orange-500 animate-spin mx-auto mb-3" />
                  <p className="text-slate-400 text-sm">正在分析攀爬数据...</p>
                  <p className="text-slate-600 text-xs mt-1">GLM-4-Flash 正在生成专业报告</p>
                </div>
              </div>
            ) : reportError ? (
              <div className="text-center py-8">
                <p className="text-red-400 text-sm mb-2">报告生成失败</p>
                <p className="text-slate-500 text-xs">{reportError}</p>
              </div>
            ) : report ? (
              <div className="space-y-6">
                {/* Summary */}
                <div className="bg-slate-800/50 rounded-2xl p-5">
                  <div className="flex items-center gap-2 text-emerald-400 mb-3">
                    <ListChecks className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">训练摘要</span>
                  </div>
                  <p className="text-slate-200 text-base leading-relaxed italic font-medium">
                    "{report.summary}"
                  </p>
                </div>

                {/* Strengths */}
                {report.strengths && report.strengths.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 text-emerald-400 mb-3">
                      <TrendingUp className="w-4 h-4" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">优点</span>
                    </div>
                    <div className="space-y-2">
                      {report.strengths.map((s, i) => (
                        <div key={i} className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 flex items-start gap-3">
                          <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                            <span className="text-[10px] font-bold text-emerald-400">{i + 1}</span>
                          </div>
                          <p className="text-slate-300 text-sm">{s}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Weaknesses */}
                {report.weaknesses && report.weaknesses.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 text-orange-400 mb-3">
                      <AlertTriangle className="w-4 h-4" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">改进点</span>
                    </div>
                    <div className="space-y-2">
                      {report.weaknesses.map((w, i) => (
                        <div key={i} className="bg-orange-500/10 border border-orange-500/20 rounded-xl px-4 py-3 flex items-start gap-3">
                          <div className="w-5 h-5 rounded-full bg-orange-500/20 flex items-center justify-center shrink-0 mt-0.5">
                            <span className="text-[10px] font-bold text-orange-400">{i + 1}</span>
                          </div>
                          <p className="text-slate-300 text-sm">{w}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Improvements */}
                {report.improvements && report.improvements.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 text-blue-400 mb-3">
                      <Lightbulb className="w-4 h-4" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">改进建议</span>
                    </div>
                    <div className="space-y-2">
                      {report.improvements.map((imp, i) => (
                        <div key={i} className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3 flex items-start gap-3">
                          <div className="w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
                            <span className="text-[10px] font-bold text-blue-400">{i + 1}</span>
                          </div>
                          <p className="text-slate-300 text-sm">{imp}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Trend */}
                {report.trend && (
                  <div className="bg-slate-800/30 rounded-2xl p-5 border border-slate-700/30">
                    <div className="flex items-center gap-2 text-purple-400 mb-3">
                      <Trophy className="w-4 h-4" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">趋势分析</span>
                    </div>
                    <p className="text-slate-400 text-sm leading-relaxed italic">
                      "{report.trend}"
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-slate-500 text-lg leading-relaxed italic font-medium py-6 text-center">
                "未检测到足够的攀爬数据进行深度分析。"
              </p>
            )}
          </div>
        </div>

        {/* 导出完整数据 */}
        <div className="mb-4">
          <button
            onClick={() => {
              const exportData = {
                ...data,
                aiReport: report,
                hasVideo: !!recordedVideo,
                snapshotCount: data.history.filter(h => h.snapshot).length
              };
              const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `攀爬报告-${new Date(data.startTime).toLocaleDateString()}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="w-full bg-slate-900 border border-slate-800 py-3.5 rounded-2xl font-bold text-slate-300 flex items-center justify-center gap-2 hover:bg-slate-800 active:scale-95 transition-all text-sm"
          >
            <Share2 className="w-4 h-4" />
            导出 JSON 报告
          </button>
        </div>

        {/* Actions */}
        <div className="space-y-4">
          <button
            onClick={onReset}
            className="w-full bg-white text-slate-950 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-slate-200 active:scale-95 transition-colors"
          >
            继续攀爬
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <footer className="mt-16 text-center opacity-30 flex flex-col items-center">
            <p className="text-[10px] uppercase tracking-[0.5em] font-mono">
              Bouldering AI Systems · GLM-4.6V-Flash
            </p>
            <p className="text-[8px] mt-1 font-mono">ENCRYPTED DATA STREAM · v4.2 PRO</p>
        </footer>
      </motion.div>
    </div>
  );
};
