import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AnalysisResult } from '../types';
import { Volume2 } from 'lucide-react';

interface GuidancePanelProps {
  result: AnalysisResult | null;
  isAnalyzing: boolean;
}

export const GuidancePanel: React.FC<GuidancePanelProps> = ({ result, isAnalyzing }) => {
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
      speakWithGLM(result.instruction);
    }
  }, [result?.instruction]);

  /** Use server-side GLM-4-Voice TTS, fallback to browser SpeechSynthesis */
  const speakWithGLM = async (text: string) => {
    if (!text) return;

    try {
      // Cancel any ongoing audio
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) throw new Error(`TTS server error: ${response.status}`);

      // Server returns audio/mpeg binary
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
      };

      audio.onerror = () => {
        console.warn('Audio playback failed, falling back to browser TTS');
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
        speakBrowserFallback(text);
      };

      await audio.play();
    } catch (err) {
      console.warn('Server TTS unavailable, using browser TTS fallback:', err);
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
                  <span>GLM-4-Voice</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
