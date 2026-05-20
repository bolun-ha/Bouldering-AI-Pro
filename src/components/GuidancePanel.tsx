import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AnalysisResult } from '../types';
import { Volume2 } from 'lucide-react';

const WS_URL = 'wss://open.bigmodel.cn/api/paas/v4/realtime';

/**
 * Decode base64 string to ArrayBuffer
 */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const buf = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
  return buf;
}

/** Simple unique event ID */
let eventCounter = 0;
function nextEventId(): string {
  return `evt_${Date.now()}_${++eventCounter}`;
}

interface GuidancePanelProps {
  result: AnalysisResult | null;
  isAnalyzing: boolean;
  error?: string | null;
}

export const GuidancePanel: React.FC<GuidancePanelProps> = ({ result, isAnalyzing, error }) => {
  const lastInstructionRef = useRef<string>("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (result?.instruction && result.instruction !== lastInstructionRef.current) {
      console.log("AI Instruction Received:", result.instruction);
      lastInstructionRef.current = result.instruction;
      speakWithRealtime(result.instruction);
    }
  }, [result?.instruction]);

  /**
   * Speak via GLM-Realtime-Flash (WebSocket + JWT auth)
   * Fallback: browser SpeechSynthesis
   */
  const speakWithRealtime = async (text: string) => {
    if (!text) return;

    // Cancel any ongoing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    try {
      // 1. Get JWT from server
      const jwtRes = await fetch('/api/jwt', { cache: 'no-store' });
      if (!jwtRes.ok) throw new Error(`JWT fetch error: ${jwtRes.status}`);
      const { token } = await jwtRes.json();
      if (!token) throw new Error('No JWT token returned');

      // 2. Open WebSocket with JWT as query parameter (browser WS can't set custom headers)
      const ws = new WebSocket(`${WS_URL}?Authorization=${token}`);

      // 3. Handle WebSocket events — collect audio audioChunks
      const audioChunks: ArrayBuffer[] = [];
      await new Promise<void>((resolve, reject) => {
        let wsClosed = false;

        const timeout = setTimeout(() => {
          if (!wsClosed) {
            ws.close();
            reject(new Error('Realtime TTS timeout'));
          }
        }, 15000); // 15s timeout

        ws.onopen = () => {
          console.log('Realtime WS connected');
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            console.log('WS msg:', msg.type, msg);

            switch (msg.type) {
              case 'session.created':
                // Send session config
                ws.send(JSON.stringify({
                  event_id: nextEventId(),
                  type: 'session.update',
                  session: {
                    modalities: ['text', 'audio'],
                    instructions: '你是一个抱石教练语音助手。用户发送指令文本，你只需用自然口语简短读出，不做解释或回应。控制在20字以内。',
                    voice: 'tongtong',
                    output_audio_format: 'mp3',
                  },
                }));
                break;

              case 'session.updated':
                console.log('WS session.updated:', msg);
                // Session ready — send text instruction
                ws.send(JSON.stringify({
                  event_id: nextEventId(),
                  type: 'conversation.item.create',
                  item: {
                    type: 'message',
                    role: 'user',
                    content: [{ type: 'input_text', text }],
                  },
                }));
                // Trigger response
                ws.send(JSON.stringify({
                  event_id: nextEventId(),
                  type: 'response.create',
                  response: {
                    modalities: ['text', 'audio'],
                    output_audio_format: 'mp3',
                  },
                }));
                break;

              case 'response.audio.delta':
                // Collect audio chunk (base64 MP3)
                if (msg.delta) {
                  audioChunks.push(base64ToArrayBuffer(msg.delta));
                }
                break;

              case 'response.done':
                clearTimeout(timeout);
                if (!wsClosed) {
                  wsClosed = true;
                  ws.close();
                }
                resolve();
                break;

              case 'error':
                clearTimeout(timeout);
                if (!wsClosed) {
                  wsClosed = true;
                  ws.close();
                }
                reject(new Error(msg.error?.message || 'Realtime API error'));
                break;
            }
          } catch (e) {
            console.warn('WS message parse error:', e);
          }
        };

        ws.onerror = (err) => {
          clearTimeout(timeout);
          console.warn('WS error:', err);
          if (!wsClosed) {
            wsClosed = true;
            ws.close();
          }
          reject(new Error('WebSocket connection failed'));
        };

        ws.onclose = () => {
          wsClosed = true;
        };
      });

      // 4. Play collected audio
      if (audioChunks.length === 0) {
        console.warn('No audio audioChunks received, using browser TTS fallback');
        speakBrowserFallback(text);
        return;
      }

      // Concatenate all MP3 audioChunks into one blob
      const totalLen = audioChunks.reduce((sum, c) => sum + c.byteLength, 0);
      const fullBuffer = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of audioChunks) {
        fullBuffer.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
      }

      const blob = new Blob([fullBuffer], { type: 'audio/mp3' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
      };

      audio.onerror = () => {
        console.warn('MP3 playback failed, trying browser TTS fallback');
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
        speakBrowserFallback(text);
      };

      await audio.play();
    } catch (err) {
      console.warn('Realtime TTS failed, using browser TTS fallback:', err);
      speakBrowserFallback(text);
    }
  };

  /** Browser SpeechSynthesis fallback */
  const speakBrowserFallback = (text: string) => {
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      const zhVoice = voices.find(v => v.lang.includes('zh'));
      if (zhVoice) utterance.voice = zhVoice;
      utterance.lang = 'zh-CN';
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.error('Browser TTS also failed:', err);
    }
  };

  return (
    <div className="absolute top-20 left-6 right-6 z-30 pointer-events-none">
      <AnimatePresence mode="wait">
        {/* 错误提示 */}
        {error && !isAnalyzing && !result && (
          <motion.div
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            className="bg-red-950/80 backdrop-blur-md border border-red-700 p-3 rounded-2xl shadow-2xl max-w-sm mx-auto"
          >
            <div className="flex items-center gap-2 justify-center">
              <span className="w-2 h-2 bg-red-500 rounded-full" />
              <p className="text-red-300 text-xs font-medium text-center">
                AI 分析异常：{error}
              </p>
            </div>
            <p className="text-red-400/60 text-[10px] text-center mt-1">
              5 秒后自动重试
            </p>
          </motion.div>
        )}

        {/* 正常分析状态或结果显示 */}
        {(result?.instruction || isAnalyzing) && (
          <motion.div
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            className="bg-slate-950/80 backdrop-blur-md border border-slate-700 p-4 rounded-2xl shadow-2xl flex items-start gap-4 w-full max-w-sm mx-auto"
          >
            <div className="flex-1 text-center">
              <div className="flex justify-center items-center mb-1 gap-2">
                <span className="text-[10px] text-orange-500 font-bold uppercase tracking-tighter italic whitespace-nowrap">
                  {isAnalyzing ? '云端 AI 正在分析...' : 'AI 语音助手'}
                </span>
                {isAnalyzing && <div className="w-1 h-1 bg-blue-500 rounded-full animate-ping" />}
              </div>
              <p className="text-white text-base font-bold italic leading-tight">
                {isAnalyzing ? '"正在评估您的姿态..."' : `"${result?.instruction}"`}
              </p>
              {!isAnalyzing && (
                <div className="mt-2 flex items-center justify-center gap-1 text-[8px] text-slate-500 uppercase tracking-widest">
                  <Volume2 className="w-3 h-3" />
                  <span>GLM-Realtime-Flash</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
