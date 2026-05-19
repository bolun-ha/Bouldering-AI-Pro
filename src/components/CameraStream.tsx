import React, { useRef, useEffect, useCallback } from 'react';

interface CameraStreamProps {
  onFrame: (canvas: HTMLCanvasElement) => void;
  isRecording: boolean;
  captureInterval?: number; // ms
  onError?: (error: string) => void;
  onVideoReady?: (video: HTMLVideoElement) => void;
}

export const CameraStream: React.FC<CameraStreamProps> = ({ 
  onFrame, 
  isRecording, 
  captureInterval = 2000,
  onError,
  onVideoReady
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    async function setupCamera() {
      try {
        const constraints = { 
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false 
        };
        
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (initialErr) {
          console.warn("Retrying with simpler constraints...");
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            if (videoRef.current) {
              videoRef.current.play();
              onVideoReady?.(videoRef.current);
            }
          };
        }
      } catch (err: any) {
        console.error("Camera access denied:", err);
        if (onError) {
          onError(err.message || "无法访问摄像头。请确保已授予权限并在 HTTPS 环境下运行，或尝试在新窗口中打开。");
        }
      }
    }
    setupCamera();
  }, [onError, onVideoReady]);

  const captureFrame = useCallback(() => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        onFrame(canvas);
      }
    }
  }, [onFrame]);

  useEffect(() => {
    let intervalId: number;
    if (isRecording) {
      intervalId = window.setInterval(captureFrame, captureInterval);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isRecording, captureFrame, captureInterval]);

  return (
    <div className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
      />
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};
