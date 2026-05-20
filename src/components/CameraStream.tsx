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
        // 🔥 关键检查：navigator.mediaDevices 在 HTTP 环境下不存在
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          const isHttps = window.location.protocol === 'https:';
          const msg = isHttps
            ? "您的浏览器不支持摄像头访问（getUserMedia 不可用），请使用现代浏览器并确保已授予摄像头权限。"
            : "摄像头需要 HTTPS 安全环境才能访问。当前页面为 HTTP。请使用 localhost 访问，或用 HTTPS 部署。";
          throw new Error(msg);
        }

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
          // 提取有意义的中文错误
          let msg = err.message || String(err);
          if (msg.includes('Permission denied') || msg.includes('NotAllowedError')) {
            msg = "摄像头权限被拒绝。请在浏览器设置中允许摄像头访问，或检查是否有其他应用占用摄像头。";
          } else if (msg.includes('NotFoundError')) {
            msg = "未检测到摄像头设备，请确保摄像头已连接且在浏览器中已授权。";
          } else if (msg.includes('NotReadableError')) {
            msg = "摄像头被其他应用占用，请关闭其他使用摄像头的程序后重试。";
          }
          onError(msg);
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
