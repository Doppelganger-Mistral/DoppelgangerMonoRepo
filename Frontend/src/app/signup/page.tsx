"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";

export default function VoiceCalibration() {
  const [isRecording, setIsRecording] = useState(false);
  const [timeLeft, setTimeLeft] = useState(60);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const animationRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barCount = 28;
      const barWidth = Math.floor(canvas.width / (barCount * 2.2));
      const gap = barWidth * 0.6;
      const totalWidth = barCount * barWidth + (barCount - 1) * gap;
      const startX = (canvas.width - totalWidth) / 2;

      for (let i = 0; i < barCount; i++) {
        const dataIndex = Math.floor((i * bufferLength) / barCount);
        const value = dataArray[dataIndex];
        const barHeight = Math.max(4, (value / 255) * canvas.height * 0.75);

        const x = startX + i * (barWidth + gap);
        const y = (canvas.height - barHeight) / 2;

        ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
        ctx.fillRect(x, y, barWidth, barHeight);
      }
    };

    draw();
  }, []);

  const finishRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioContextRef.current?.close();
    cancelAnimationFrame(animationRef.current);
    if (timerRef.current) clearInterval(timerRef.current);

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }

    analyserRef.current = null;
    audioContextRef.current = null;
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
    setIsRecording(false);
  }, []);

  const stopAndDiscard = useCallback(() => {
    finishRecording();
    chunksRef.current = [];
    setAudioUrl(null);
    setTimeLeft(60);
  }, [finishRecording]);

  const toggleRecording = async () => {
    const click = new Audio("/clicksound.mp3");
    click.play();

    if (!isRecording) {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
        setAudioUrl(null);
      }
      chunksRef.current = [];

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });

        const recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });
          const url = URL.createObjectURL(blob);
          setAudioUrl(url);
        };
        recorder.start();
        mediaRecorderRef.current = recorder;

        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.8;
        source.connect(analyser);

        analyserRef.current = analyser;
        audioContextRef.current = audioContext;
        mediaStreamRef.current = stream;

        setIsRecording(true);
        setTimeLeft(60);
        drawWaveform();

        timerRef.current = setInterval(() => {
          setTimeLeft((prev) => {
            if (prev <= 1) {
              finishRecording();
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } catch (err) {
        console.error("Microphone access denied:", err);
      }
    } else {
      stopAndDiscard();
    }
  };

  const stopPlaybackWaveform = useCallback(() => {
    cancelAnimationFrame(animationRef.current);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  const handlePlayback = () => {
    if (!audioUrl) return;

    if (isPlaying && playbackAudioRef.current) {
      playbackAudioRef.current.pause();
      playbackAudioRef.current.currentTime = 0;
      stopPlaybackWaveform();
      playbackContextRef.current?.close();
      playbackContextRef.current = null;
      analyserRef.current = null;
      setIsPlaying(false);
      return;
    }

    const audio = new Audio(audioUrl);
    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(audio);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    analyser.connect(ctx.destination);

    analyserRef.current = analyser;
    playbackContextRef.current = ctx;
    playbackAudioRef.current = audio;

    audio.onended = () => {
      stopPlaybackWaveform();
      playbackContextRef.current?.close();
      playbackContextRef.current = null;
      analyserRef.current = null;
      setIsPlaying(false);
    };

    audio.play();
    drawWaveform();
    setIsPlaying(true);
  };

  const handleReRecord = () => {
    const click = new Audio("/clicksound.mp3");
    click.play();

    if (playbackAudioRef.current) {
      playbackAudioRef.current.pause();
      stopPlaybackWaveform();
      playbackContextRef.current?.close();
      playbackContextRef.current = null;
      analyserRef.current = null;
      setIsPlaying(false);
    }
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setTimeLeft(60);
    chunksRef.current = [];
  };

  const handleSubmit = () => {
    // TODO: upload audioUrl blob to backend
    console.log("Submitting voice recording...");
  };

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animationRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      audioContextRef.current?.close();
      if (playbackAudioRef.current) playbackAudioRef.current.pause();
      playbackContextRef.current?.close();
    };
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const recordingDone = !isRecording && audioUrl !== null;

  return (
    <main className="flex min-h-screen items-center bg-forest">
      {/* Left Content */}
      <div className="flex w-[55%] shrink-0 flex-col justify-center pl-10 md:pl-16 lg:pl-24 xl:pl-32 pr-4 py-12">
        <h1
          className="font-gordon text-cream uppercase leading-[1.15] whitespace-nowrap drop-shadow-[0_3px_6px_rgba(0,0,0,0.5)]"
          style={{ fontSize: "clamp(1.8rem, 3.8vw, 4.5rem)" }}
        >
          Voice Calibration
        </h1>

        <p className="font-benguiat text-white text-lg sm:text-xl md:text-2xl lg:text-3xl mt-4 md:mt-6 lg:mt-8 leading-[1.4]">
          {recordingDone ? (
            <>
              Recording complete!
              <br />
              Listen back or submit
            </>
          ) : (
            <>
              Talk naturally for 1 minute
              <br />
              to clone your voice
            </>
          )}
        </p>

        {isRecording && (
          <p className="font-gordon text-cream text-3xl md:text-4xl mt-6 tabular-nums drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]">
            {formatTime(timeLeft)}
          </p>
        )}

        {!recordingDone && (
          <button
            onClick={toggleRecording}
            className="mt-6 md:mt-8 cursor-pointer transition-transform duration-200 ease-out hover:scale-105 active:scale-95 w-fit"
          >
            <Image
              src={isRecording ? "/stoprecording.svg" : "/startrecording.svg"}
              alt={isRecording ? "Stop Recording" : "Start Recording"}
              width={180}
              height={60}
              className="h-auto drop-shadow-[0_4px_8px_rgba(0,0,0,0.4)]"
            />
          </button>
        )}

        {recordingDone && (
          <div className="flex flex-wrap gap-4 mt-6 md:mt-8">
            <button
              onClick={handlePlayback}
              className="px-6 md:px-8 lg:px-10 py-2 md:py-2.5 lg:py-3 border-[1.5px] border-cream rounded-full font-gordon text-cream text-xs md:text-sm uppercase tracking-[0.2em] cursor-pointer bg-transparent shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition-all duration-300 ease-out hover:bg-cream hover:text-forest hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,0,0,0.5)]"
            >
              {isPlaying ? "Stop" : "Play Back"}
            </button>
            <button
              onClick={handleReRecord}
              className="px-6 md:px-8 lg:px-10 py-2 md:py-2.5 lg:py-3 border-[1.5px] border-cream rounded-full font-gordon text-cream text-xs md:text-sm uppercase tracking-[0.2em] cursor-pointer bg-transparent shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition-all duration-300 ease-out hover:bg-cream hover:text-forest hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,0,0,0.5)]"
            >
              Re-record
            </button>
            <button
              onClick={handleSubmit}
              className="px-6 md:px-8 lg:px-10 py-2 md:py-2.5 lg:py-3 border-[1.5px] border-cream rounded-full font-gordon text-cream text-xs md:text-sm uppercase tracking-[0.2em] cursor-pointer bg-cream text-forest shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition-all duration-300 ease-out hover:bg-transparent hover:text-cream hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,0,0,0.5)]"
            >
              Submit
            </button>
          </div>
        )}
      </div>

      {/* Right - Monitor SVG with waveform overlay */}
      <div className="relative w-[45%] self-stretch flex items-center justify-center">
        <div className="relative w-full max-w-[500px]">
          <Image
            src="/monitor.svg"
            alt="CRT Monitor"
            width={500}
            height={500}
            className="w-full h-auto"
            priority
          />
          <canvas
            ref={canvasRef}
            width={400}
            height={300}
            className="absolute top-[18%] left-[15%] w-[55%] h-[42%]"
          />
        </div>
      </div>
    </main>
  );
}
