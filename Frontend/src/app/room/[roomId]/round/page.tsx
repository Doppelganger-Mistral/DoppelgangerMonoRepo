"use client";

import { Suspense, useState, useRef, useEffect, useMemo, useCallback } from "react";
import Image from "next/image";
import { useParams, useSearchParams } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const WS_URL = API_URL.replace(/^http/, "ws");
const MAX_RECORD_SECONDS = 15;

interface PlayerAudio {
  player: string;
  assignedPlayer: string;
  blobUrl: string;
}

export default function RoundPageWrapper() {
  return (
    <Suspense>
      <RoundPage />
    </Suspense>
  );
}

function RoundPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const searchParams = useSearchParams();

  const username = searchParams.get("username") ?? "";
  const roundNum = searchParams.get("round") ?? "1";
  const maxRounds = searchParams.get("maxRounds") ?? "1";
  const assignedPlayer = searchParams.get("assignedPlayer") ?? "";
  const players: string[] = useMemo(() => {
    try {
      return JSON.parse(searchParams.get("players") ?? "[]");
    } catch {
      return [];
    }
  }, [searchParams]);

  const [showPopup, setShowPopup] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [timeLeft, setTimeLeft] = useState(MAX_RECORD_SECONDS);
  const [converting, setConverting] = useState(false);
  const [donePlayers, setDonePlayers] = useState<Set<string>>(new Set());
  const [myDone, setMyDone] = useState(false);
  const [phase, setPhase] = useState<"recording" | "playback">("recording");
  const [allAudios, setAllAudios] = useState<PlayerAudio[]>([]);
  const [currentlyPlaying, setCurrentlyPlaying] = useState(-1);
  const [error, setError] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const playbackAudioRef = useRef<HTMLAudioElement | null>(null);

  const stopRecordingCleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
    setIsRecording(false);
  }, []);

  const processRecording = useCallback(
    async (blob: Blob) => {
      setConverting(true);
      setError("");

      try {
        const convertForm = new FormData();
        convertForm.append("username", assignedPlayer);
        convertForm.append("audio", blob, "recording.webm");

        const convertRes = await fetch(`${API_URL}/round/convert`, {
          method: "POST",
          body: convertForm,
        });

        if (!convertRes.ok) {
          const body = await convertRes.json().catch(() => null);
          setError(body?.detail ?? "Voice conversion failed");
          setConverting(false);
          return;
        }

        const mp3Blob = await convertRes.blob();

        const uploadForm = new FormData();
        uploadForm.append("audio", mp3Blob, `${username}.mp3`);
        uploadForm.append("room_id", roomId);
        uploadForm.append("round_id", roundNum);
        uploadForm.append("username", username);

        const uploadRes = await fetch(`${API_URL}/upload/s3`, {
          method: "POST",
          body: uploadForm,
        });

        if (!uploadRes.ok) {
          const body = await uploadRes.json().catch(() => null);
          setError(body?.detail ?? "Upload failed");
          setConverting(false);
          return;
        }

        setMyDone(true);
        setConverting(false);

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              event: "recording_done",
              username,
              assignedPlayer,
            })
          );
        }
      } catch {
        setError("Could not reach the server");
        setConverting(false);
      }
    },
    [assignedPlayer, roomId, roundNum, username]
  );

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        processRecording(blob);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      mediaStreamRef.current = stream;
      setIsRecording(true);
      setTimeLeft(MAX_RECORD_SECONDS);

      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            mediaRecorderRef.current?.stop();
            stopRecordingCleanup();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch {
      setError("Microphone access denied");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    stopRecordingCleanup();
  };

  const handleRecordToggle = () => {
    if (myDone || converting) return;
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  // WebSocket for real-time done status
  useEffect(() => {
    if (!roomId) return;

    const ws = new WebSocket(`${WS_URL}/room/${roomId}/ws`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.event === "recording_done" && msg.username) {
          setDonePlayers((prev) => {
            const next = new Set(prev);
            next.add(msg.username);
            return next;
          });
        }
      } catch {
        // ignore
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [roomId]);

  // Check if all players are done → transition to playback
  useEffect(() => {
    if (
      players.length > 0 &&
      donePlayers.size >= players.length &&
      phase === "recording"
    ) {
      const fetchAllAudios = async () => {
        const audios: PlayerAudio[] = [];
        for (const player of players) {
          try {
            const res = await fetch(
              `${API_URL}/download/s3?room_id=${encodeURIComponent(roomId)}&round_id=${encodeURIComponent(roundNum)}&username=${encodeURIComponent(player)}`
            );
            if (res.ok) {
              const blob = await res.blob();
              audios.push({
                player,
                assignedPlayer: "",
                blobUrl: URL.createObjectURL(blob),
              });
            }
          } catch {
            // skip failed fetches
          }
        }
        setAllAudios(audios);
        setPhase("playback");
      };
      fetchAllAudios();
    }
  }, [donePlayers, players, phase, roomId, roundNum]);

  // Auto-play audios sequentially
  useEffect(() => {
    if (phase !== "playback" || allAudios.length === 0) return;
    if (currentlyPlaying === -1) {
      setCurrentlyPlaying(0);
    }
  }, [phase, allAudios, currentlyPlaying]);

  useEffect(() => {
    if (phase !== "playback" || currentlyPlaying < 0 || currentlyPlaying >= allAudios.length) return;

    const audio = new Audio(allAudios[currentlyPlaying].blobUrl);
    playbackAudioRef.current = audio;

    audio.onended = () => {
      setCurrentlyPlaying((prev) =>
        prev + 1 < allAudios.length ? prev + 1 : -2
      );
    };

    audio.play().catch(() => {});

    return () => {
      audio.pause();
      audio.onended = null;
    };
  }, [currentlyPlaying, phase, allAudios]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (playbackAudioRef.current) playbackAudioRef.current.pause();
    };
  }, []);

  const formatTime = (s: number) => `0:${s.toString().padStart(2, "0")}`;

  // ─── Playback phase ───
  if (phase === "playback") {
    return (
      <main className="flex flex-col min-h-screen bg-forest px-8 md:px-16 lg:px-24 py-10 md:py-16">
        <div className="flex justify-center">
          <Image
            src="/titlefont.svg"
            alt="Doppelgänger"
            width={800}
            height={160}
            className="w-[70vw] max-w-[650px] h-auto drop-shadow-[0_3px_6px_rgba(0,0,0,0.5)]"
            priority
          />
        </div>

        <div className="flex justify-end mt-6 md:mt-10">
          <h2 className="font-gordon text-cream text-xl md:text-2xl lg:text-3xl uppercase tracking-[0.15em]">
            Round {roundNum} — Playback
          </h2>
        </div>

        <div className="flex flex-col gap-6 mt-10 md:mt-14 max-w-2xl mx-auto w-full">
          {allAudios.map((entry, idx) => {
            const isActive = idx === currentlyPlaying;
            const isPlayed = currentlyPlaying === -2 || (currentlyPlaying >= 0 && idx < currentlyPlaying);
            return (
              <div
                key={entry.player}
                className={`flex items-center gap-6 px-6 py-4 rounded-xl border-[1.5px] transition-all duration-300 ${
                  isActive
                    ? "border-white bg-cream/10 shadow-[0_0_20px_rgba(213,206,196,0.15)]"
                    : isPlayed
                    ? "border-cream/40 opacity-60"
                    : "border-cream/20 opacity-40"
                }`}
              >
                <div className="flex items-center justify-center w-8 h-8 shrink-0">
                  {isActive ? (
                    <span className="block w-3 h-3 rounded-full bg-cream animate-pulse" />
                  ) : isPlayed ? (
                    <span className="font-gordon text-cream/60 text-lg">&#10003;</span>
                  ) : (
                    <span className="block w-3 h-3 rounded-full border border-cream/30" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="font-gordon text-cream text-base md:text-lg uppercase tracking-[0.1em]">
                    Cloned as {entry.player}
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (playbackAudioRef.current) {
                      playbackAudioRef.current.pause();
                      playbackAudioRef.current.onended = null;
                    }
                    setCurrentlyPlaying(idx);
                  }}
                  className="px-4 py-1.5 border border-cream/40 rounded-full font-gordon text-cream text-xs uppercase tracking-wider hover:bg-cream/10 transition-colors cursor-pointer"
                >
                  {isActive ? "Playing..." : "Play"}
                </button>
              </div>
            );
          })}
        </div>
      </main>
    );
  }

  // ─── Recording phase ───
  return (
    <main className="flex flex-col min-h-screen bg-forest px-8 md:px-16 lg:px-24 py-10 md:py-16">
      {/* Title */}
      <div className="flex justify-center">
        <Image
          src="/titlefont.svg"
          alt="Doppelgänger"
          width={800}
          height={160}
          className="w-[70vw] max-w-[650px] h-auto drop-shadow-[0_3px_6px_rgba(0,0,0,0.5)]"
          priority
        />
      </div>

      {/* Round header */}
      <div className="flex justify-end mt-6 md:mt-10">
        <h2 className="font-gordon text-cream text-xl md:text-2xl lg:text-3xl uppercase tracking-[0.15em]">
          Round {roundNum}
        </h2>
      </div>

      {/* Main content */}
      <div className="flex mt-8 md:mt-12 gap-8 lg:gap-16 flex-1">
        {/* Left: Players grid with checkmarks */}
        <div className="w-[45%] grid grid-cols-2 gap-x-8 gap-y-10 md:gap-x-12 md:gap-y-14 content-start pt-4">
          {players.map((player) => {
            const isDone = donePlayers.has(player);
            return (
              <div key={player} className="flex flex-col items-center gap-2">
                <svg
                  width="36"
                  height="36"
                  viewBox="0 0 36 36"
                  className={`transition-opacity duration-300 ${isDone ? "opacity-100" : "opacity-20"}`}
                >
                  <path
                    d="M6 18 L14 26 L30 10"
                    fill="none"
                    stroke={isDone ? "#a8d5ba" : "#d5cec4"}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <p
                  className={`font-benguiat text-base md:text-lg lg:text-xl ${
                    player === username ? "text-white" : "text-cream/80"
                  }`}
                >
                  {player}
                </p>
              </div>
            );
          })}
        </div>

        {/* Right: Prompt text + Recording */}
        <div className="w-[55%] flex flex-col">
          <div className="flex-1">
            <p className="font-benguiat text-cream/70 text-sm md:text-base lg:text-lg leading-relaxed">
              Placeholder prompt Placeholder promptPlaceholder
              promptPlaceholder promptPlaceholder
              promptPlaceholder promptPlaceholder
              promptPlaceholder prompt
            </p>
          </div>

          {/* Status messages */}
          {converting && (
            <p className="font-benguiat text-cream/60 text-sm md:text-base mt-4 animate-pulse">
              Converting voice... this may take a moment
            </p>
          )}
          {myDone && (
            <p className="font-benguiat text-green-400/80 text-sm md:text-base mt-4">
              Recording submitted! Waiting for other players...
            </p>
          )}
          {error && (
            <p className="font-benguiat text-red-400 text-sm md:text-base mt-4">
              {error}
            </p>
          )}

          {/* Timer */}
          {isRecording && (
            <p className="font-gordon text-cream text-2xl md:text-3xl mt-4 tabular-nums drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]">
              {formatTime(timeLeft)}
            </p>
          )}

          {/* Record button */}
          <div className="flex justify-end mt-6">
            {!myDone && !converting && (
              <button
                onClick={handleRecordToggle}
                className="cursor-pointer transition-transform duration-200 ease-out hover:scale-105 active:scale-95 w-fit"
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
          </div>
        </div>
      </div>

      {/* Impersonation popup */}
      {showPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div
            className="bg-forest border-[1.5px] border-cream rounded-2xl p-8 md:p-10 w-[90%] max-w-md shadow-[0_8px_40px_rgba(0,0,0,0.6)] text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              className="font-gordon text-cream uppercase drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]"
              style={{ fontSize: "clamp(1.2rem, 2.2vw, 1.8rem)" }}
            >
              Round {roundNum} of {maxRounds}
            </h2>
            <p className="font-benguiat text-white text-lg md:text-xl mt-6 leading-relaxed">
              You will be impersonating
            </p>
            <p className="font-gordon text-cream text-2xl md:text-3xl mt-2 tracking-wide">
              {assignedPlayer}
            </p>
            <button
              onClick={() => setShowPopup(false)}
              className="mt-8 px-10 py-3 border-[1.5px] border-cream rounded-full font-gordon text-sm uppercase tracking-[0.2em] cursor-pointer bg-cream text-forest shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition-all duration-300 ease-out hover:bg-transparent hover:text-cream hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,0,0,0.5)]"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
