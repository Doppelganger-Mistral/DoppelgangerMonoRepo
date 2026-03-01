"use client";

import { Suspense, useState, useRef, useEffect, useMemo, useCallback } from "react";
import Image from "next/image";
import { useParams, useSearchParams, useRouter } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const WS_URL = API_URL.replace(/^http/, "ws");
const MAX_RECORD_SECONDS = 15;

interface PlayerAudio {
  player: string;
  assignedPlayer: string;
  blobUrl: string;
}

function RoundPageKey() {
  const searchParams = useSearchParams();
  const roundNum = searchParams.get("round") ?? "1";
  return <RoundPage key={roundNum} />;
}

export default function RoundPageWrapper() {
  return (
    <Suspense>
      <RoundPageKey />
    </Suspense>
  );
}

function RoundPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const username = searchParams.get("username") ?? "";
  const roundNum = searchParams.get("round") ?? "1";
  const maxRounds = searchParams.get("maxRounds") ?? "1";
  const assignedPlayer = searchParams.get("assignedPlayer") ?? "";
  const roundPrompt = searchParams.get("roundPrompt") ?? "";
  const players: string[] = useMemo(() => {
    try {
      return JSON.parse(searchParams.get("players") ?? "[]");
    } catch {
      return [];
    }
  }, [searchParams]);

  const isHost = players.length > 0 && players[0] === username;

  const [showPopup, setShowPopup] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [timeLeft, setTimeLeft] = useState(MAX_RECORD_SECONDS);
  const [converting, setConverting] = useState(false);
  const [donePlayers, setDonePlayers] = useState<Set<string>>(new Set());
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [myDone, setMyDone] = useState(false);
  const [phase, setPhase] = useState<"recording" | "playback" | "guessing" | "results">("recording");
  const [allAudios, setAllAudios] = useState<PlayerAudio[]>([]);
  const [currentlyPlaying, setCurrentlyPlaying] = useState(-1);
  const [error, setError] = useState("");

  // Guessing phase
  const [guesses, setGuesses] = useState<Record<string, string>>({});
  const [selectedLeft, setSelectedLeft] = useState<string | null>(null);
  const [submittingGuess, setSubmittingGuess] = useState(false);

  // Results phase
  const [scoreResults, setScoreResults] = useState<{
    correct: number;
    total: number;
    score: number;
    results: Record<string, { guessed: string; actual: string; correct: boolean }>;
  } | null>(null);
  const [leaderboard, setLeaderboard] = useState<Record<string, number>>({});
  const [finalLeaderboard, setFinalLeaderboard] = useState<Record<string, number>>({});
  const [showLeaderboardPopup, setShowLeaderboardPopup] = useState(false);
  const [isFinalRound, setIsFinalRound] = useState(false);
  const [loadingNextRound, setLoadingNextRound] = useState(false);
  const [doneGuessPlayers, setDoneGuessPlayers] = useState<Set<string>>(new Set());
  const [waitingForGuesses, setWaitingForGuesses] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const playbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number>(0);

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
          if (msg.assignedPlayer) {
            setAssignments((prev) => ({
              ...prev,
              [msg.username]: msg.assignedPlayer,
            }));
          }
        } else if (msg.event === "guessing_done" && msg.username) {
          setDoneGuessPlayers((prev) => {
            const next = new Set(prev);
            next.add(msg.username);
            return next;
          });
        } else if (msg.event === "game_started" && msg.round_num > Number(roundNum)) {
          const newAssigned = msg.assignments?.[username] ?? "";
          const params = new URLSearchParams({
            username,
            round: String(msg.round_num),
            maxRounds: String(msg.max_rounds),
            assignedPlayer: newAssigned,
            players: JSON.stringify(msg.players),
            roundPrompt: msg.round_prompt ?? "",
          });
          router.push(`/room/${roomId}/round?${params.toString()}`);
          router.refresh();
        }
      } catch {
        // ignore
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [roomId, roundNum, username, router]);

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
                assignedPlayer: assignments[player] ?? player,
                blobUrl: URL.createObjectURL(blob),
              });
            }
          } catch {
            // skip failed fetches
          }
        }
        setAllAudios(audios);
        setPhase("playback");
        setCurrentlyPlaying(0);
      };
      fetchAllAudios();
    }
  }, [donePlayers, players, phase, roomId, roundNum, assignments]);

  // All players guessed → fetch leaderboard and show popup
  useEffect(() => {
    if (
      players.length > 0 &&
      doneGuessPlayers.size >= players.length &&
      waitingForGuesses
    ) {
      const fetchLeaderboard = async () => {
        const finalRound = Number(roundNum) >= Number(maxRounds);
        if (finalRound) {
          const flbRes = await fetch(
            `${API_URL}/room/leaderboard/final?room_id=${encodeURIComponent(roomId)}`
          );
          if (flbRes.ok) {
            const flbData = await flbRes.json();
            setFinalLeaderboard(flbData.leaderboard ?? {});
          }
        } else {
          const lbRes = await fetch(
            `${API_URL}/room/leaderboard?room_id=${encodeURIComponent(roomId)}&round_num=${encodeURIComponent(roundNum)}`
          );
          if (lbRes.ok) {
            const lbData = await lbRes.json();
            setLeaderboard(lbData.leaderboard ?? {});
          }
        }
        setWaitingForGuesses(false);
        setShowLeaderboardPopup(true);
      };
      fetchLeaderboard();
    }
  }, [doneGuessPlayers, players, waitingForGuesses, roomId, roundNum, maxRounds]);

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barCount = 40;
      const barWidth = Math.floor(canvas.width / (barCount * 2));
      const gap = barWidth * 0.5;
      const totalWidth = barCount * barWidth + (barCount - 1) * gap;
      const startX = (canvas.width - totalWidth) / 2;

      for (let i = 0; i < barCount; i++) {
        const dataIndex = Math.floor((i * bufferLength) / barCount);
        const value = dataArray[dataIndex];
        const barHeight = Math.max(2, (value / 255) * canvas.height * 0.85);

        const x = startX + i * (barWidth + gap);
        const y = (canvas.height - barHeight) / 2;

        ctx.fillStyle = "rgba(213, 206, 196, 0.7)";
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 1);
        ctx.fill();
      }
    };

    draw();
  }, []);

  const stopWaveform = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  useEffect(() => {
    if (phase !== "playback" || currentlyPlaying < 0 || currentlyPlaying >= allAudios.length) return;

    stopWaveform();
    audioCtxRef.current?.close();

    const audio = new Audio(allAudios[currentlyPlaying].blobUrl);
    playbackAudioRef.current = audio;

    const actx = new AudioContext();
    const source = actx.createMediaElementSource(audio);
    const analyser = actx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    analyser.connect(actx.destination);

    analyserRef.current = analyser;
    audioCtxRef.current = actx;

    audio.onended = () => {
      stopWaveform();
      setCurrentlyPlaying((prev) =>
        prev + 1 < allAudios.length ? prev + 1 : -2
      );
    };

    audio.play().then(() => drawWaveform()).catch(() => {});

    return () => {
      audio.pause();
      audio.onended = null;
      stopWaveform();
    };
  }, [currentlyPlaying, phase, allAudios, drawWaveform, stopWaveform]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (playbackAudioRef.current) playbackAudioRef.current.pause();
      cancelAnimationFrame(animFrameRef.current);
      audioCtxRef.current?.close();
    };
  }, []);

  const formatTime = (s: number) => `0:${s.toString().padStart(2, "0")}`;

  const handleNextRound = async () => {
    setLoadingNextRound(true);
    try {
      const formData = new FormData();
      formData.append("room_id", roomId);

      const res = await fetch(`${API_URL}/room/next_round`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.detail ?? "Failed to start next round");
        setLoadingNextRound(false);
        return;
      }

      const data = await res.json();
      const newAssigned = data.assignments?.[username] ?? "";
      const params = new URLSearchParams({
        username,
        round: String(data.round_num),
        maxRounds: String(data.max_rounds),
        assignedPlayer: newAssigned,
        players: JSON.stringify(data.players),
        roundPrompt: data.round_prompt ?? "",
      });
      router.push(`/room/${roomId}/round?${params.toString()}`);
      router.refresh();
    } catch {
      setError("Could not reach the server");
      setLoadingNextRound(false);
    }
  };

  const doppelgangerNames = allAudios.map((a) => a.assignedPlayer);

  const handleGuessMatch = (doppelName: string) => {
    if (selectedLeft === null) {
      setSelectedLeft(doppelName);
      return;
    }
    if (selectedLeft === doppelName) {
      setSelectedLeft(null);
      return;
    }
    setSelectedLeft(null);
  };

  const handleOriginalMatch = (playerName: string) => {
    if (!selectedLeft) return;
    setGuesses((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(next)) {
        if (v === selectedLeft) delete next[k];
      }
      next[playerName] = selectedLeft;
      return next;
    });
    setSelectedLeft(null);
  };

  const removeGuess = (playerName: string) => {
    setGuesses((prev) => {
      const next = { ...prev };
      delete next[playerName];
      return next;
    });
  };

  const submitGuesses = async () => {
    if (Object.keys(guesses).length !== players.length) return;

    setSubmittingGuess(true);
    setError("");

    try {
      const res = await fetch(`${API_URL}/room/check-match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: roomId,
          round_num: Number(roundNum),
          username,
          matches: guesses,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.detail ?? "Failed to submit guesses");
        setSubmittingGuess(false);
        return;
      }

      const data = await res.json();
      setScoreResults({
        correct: data.correct,
        total: data.total,
        score: data.score,
        results: data.results,
      });

      setIsFinalRound(Number(roundNum) >= Number(maxRounds));

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({ event: "guessing_done", username })
        );
      }
      setDoneGuessPlayers((prev) => {
        const next = new Set(prev);
        next.add(username);
        return next;
      });

      setSubmittingGuess(false);
      setPhase("results");
      setWaitingForGuesses(true);
    } catch {
      setError("Could not reach the server");
      setSubmittingGuess(false);
    }
  };

  // ─── Playback phase ───
  if (phase === "playback") {
    return (
      <main className="flex flex-col min-h-screen bg-forest px-8 md:px-16 lg:px-24 py-10 md:py-16 items-center">
        <Image
          src="/titlefont.svg"
          alt="Doppelgänger"
          width={800}
          height={160}
          className="w-[70vw] max-w-[650px] h-auto drop-shadow-[0_3px_6px_rgba(0,0,0,0.5)]"
          priority
        />

        <h2 className="font-gordon text-cream text-xl md:text-2xl lg:text-3xl uppercase tracking-[0.15em] mt-8 md:mt-12 text-center">
          Round {roundNum} — Playback
        </h2>

        {/* Waveform canvas */}
        <canvas
          ref={canvasRef}
          width={500}
          height={80}
          className="w-full max-w-2xl mt-8"
        />

        <div className="flex flex-col gap-5 mt-6 md:mt-8 max-w-2xl w-full">
          {allAudios.map((entry, idx) => {
            const isActive = idx === currentlyPlaying;
            const isPlayed = currentlyPlaying === -2 || (currentlyPlaying >= 0 && idx < currentlyPlaying);
            return (
              <div
                key={entry.player}
                className={`flex items-center gap-5 px-6 py-4 rounded-xl border-[1.5px] transition-all duration-300 ${
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
                    {entry.assignedPlayer}
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (playbackAudioRef.current) {
                      playbackAudioRef.current.pause();
                      playbackAudioRef.current.onended = null;
                    }
                    stopWaveform();
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

        <button
          onClick={() => {
            if (playbackAudioRef.current) {
              playbackAudioRef.current.pause();
              playbackAudioRef.current.onended = null;
            }
            stopWaveform();
            setPhase("guessing");
          }}
          className="mt-10 px-10 md:px-14 py-3 md:py-3.5 border-[1.5px] border-cream rounded-full font-gordon text-cream text-sm md:text-base uppercase tracking-[0.2em] cursor-pointer bg-transparent shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition-all duration-300 ease-out hover:bg-cream hover:text-forest hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,0,0,0.5)]"
        >
          Start Guessing
        </button>
      </main>
    );
  }

  // ─── Guessing phase ───
  if (phase === "guessing") {
    const matchedDoppels = new Set(Object.values(guesses));

    return (
      <main className="flex flex-col min-h-screen bg-forest px-8 md:px-16 lg:px-24 py-10 md:py-16 items-center">
        <Image
          src="/titlefont.svg"
          alt="Doppelgänger"
          width={800}
          height={160}
          className="w-[70vw] max-w-[650px] h-auto drop-shadow-[0_3px_6px_rgba(0,0,0,0.5)]"
          priority
        />

        <h2 className="font-gordon text-cream text-xl md:text-2xl lg:text-3xl uppercase tracking-[0.15em] mt-8 text-center">
          Round {roundNum}
        </h2>

        <div className="flex gap-8 md:gap-16 lg:gap-24 mt-10 md:mt-14 w-full max-w-3xl justify-center">
          {/* Left: Doppelganger voices */}
          <div className="flex flex-col items-center gap-2">
            <h3 className="font-gordon text-cream text-sm md:text-base uppercase tracking-[0.2em] mb-4">
              Doppelganger
            </h3>
            <div className="flex flex-col gap-4">
              {doppelgangerNames.map((name) => {
                const isUsed = matchedDoppels.has(name);
                const isSelected = selectedLeft === name;
                return (
                  <button
                    key={name}
                    onClick={() => handleGuessMatch(name)}
                    className={`px-6 py-3 rounded-lg border-[1.5px] font-benguiat text-base md:text-lg transition-all duration-200 cursor-pointer ${
                      isSelected
                        ? "border-white bg-cream/20 text-white scale-105"
                        : isUsed
                        ? "border-cream/30 text-cream/40"
                        : "border-cream/60 text-cream hover:border-white hover:bg-cream/10"
                    }`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Center: Connection lines */}
          <div className="flex flex-col justify-center gap-4 min-w-[60px]">
            {players.map((player) => {
              const matched = guesses[player];
              return (
                <div key={player} className="h-[52px] flex items-center justify-center">
                  {matched ? (
                    <svg width="60" height="2" className="opacity-60">
                      <line x1="0" y1="1" x2="60" y2="1" stroke="#a8d5ba" strokeWidth="2" />
                    </svg>
                  ) : (
                    <span className="block w-2 h-2 rounded-full border border-cream/20" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Right: Original players */}
          <div className="flex flex-col items-center gap-2">
            <h3 className="font-gordon text-cream text-sm md:text-base uppercase tracking-[0.2em] mb-4">
              Original
            </h3>
            <div className="flex flex-col gap-4">
              {players.map((player) => {
                const matched = guesses[player];
                return (
                  <button
                    key={player}
                    onClick={() => {
                      if (matched) {
                        removeGuess(player);
                      } else {
                        handleOriginalMatch(player);
                      }
                    }}
                    className={`px-6 py-3 rounded-lg border-[1.5px] font-benguiat text-base md:text-lg transition-all duration-200 cursor-pointer ${
                      matched
                        ? "border-green-400/60 text-green-300/80 bg-green-900/20"
                        : selectedLeft
                        ? "border-cream/60 text-cream hover:border-white hover:bg-cream/10 animate-pulse"
                        : "border-cream/60 text-cream hover:border-white hover:bg-cream/10"
                    }`}
                  >
                    {matched ? `${matched} → ${player}` : player}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {selectedLeft && (
          <p className="font-benguiat text-cream/50 text-sm mt-6 animate-pulse">
            Now click an original player to match with {selectedLeft}
          </p>
        )}

        {error && (
          <p className="font-benguiat text-red-400 text-sm mt-4">{error}</p>
        )}

        <button
          onClick={submitGuesses}
          disabled={Object.keys(guesses).length !== players.length || submittingGuess}
          className="mt-10 px-10 md:px-14 py-3 md:py-3.5 border-[1.5px] border-cream rounded-full font-gordon text-sm md:text-base uppercase tracking-[0.2em] cursor-pointer bg-cream text-forest shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition-all duration-300 ease-out hover:bg-transparent hover:text-cream hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,0,0,0.5)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:bg-cream disabled:hover:text-forest"
        >
          {submittingGuess ? "Submitting..." : "Submit Guesses"}
        </button>
      </main>
    );
  }

  // ─── Results phase ───
  if (phase === "results" && scoreResults) {
    const allGuessed = doneGuessPlayers.size >= players.length;
    const displayLeaderboard = isFinalRound ? finalLeaderboard : leaderboard;

    return (
      <main className="flex flex-col min-h-screen bg-forest px-8 md:px-16 lg:px-24 py-10 md:py-16 items-center">
        <Image
          src="/titlefont.svg"
          alt="Doppelgänger"
          width={800}
          height={160}
          className="w-[70vw] max-w-[650px] h-auto drop-shadow-[0_3px_6px_rgba(0,0,0,0.5)]"
          priority
        />

        <h2 className="font-gordon text-cream text-xl md:text-2xl lg:text-3xl uppercase tracking-[0.15em] mt-8 text-center">
          Round {roundNum} — Guesses Submitted
        </h2>

        <div className="mt-8 text-center">
          <p className="font-gordon text-cream text-4xl md:text-5xl">
            {scoreResults.correct}/{scoreResults.total}
          </p>
          <p className="font-benguiat text-cream/60 text-base md:text-lg mt-2">
            correct guesses — {scoreResults.score} points
          </p>
        </div>

        {!allGuessed && (
          <div className="mt-10 flex flex-col items-center gap-4">
            <div className="w-8 h-8 border-2 border-cream/30 border-t-cream rounded-full animate-spin" />
            <p className="font-benguiat text-cream/60 text-base">
              Waiting for other players to finish guessing ({doneGuessPlayers.size}/{players.length})...
            </p>
          </div>
        )}

        {/* Leaderboard Popup */}
        {showLeaderboardPopup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div
              className="bg-forest border-[1.5px] border-cream rounded-2xl p-8 md:p-10 w-[90%] max-w-md shadow-[0_8px_40px_rgba(0,0,0,0.6)]"
              onClick={(e) => e.stopPropagation()}
            >
              <h2
                className="font-gordon text-cream uppercase text-center drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]"
                style={{ fontSize: "clamp(1.3rem, 2.5vw, 2rem)" }}
              >
                {isFinalRound ? "Final Leaderboard" : `Round ${roundNum} Leaderboard`}
              </h2>

              <div className="flex flex-col gap-2 mt-6">
                {Object.entries(displayLeaderboard).map(([player, score], idx) => (
                  <div
                    key={player}
                    className={`flex items-center justify-between px-5 py-3 rounded-lg border-[1.5px] ${
                      idx === 0
                        ? "border-cream/60 bg-cream/10"
                        : "border-cream/20"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-gordon text-cream/50 text-sm w-6">
                        {idx + 1}.
                      </span>
                      <p className={`font-benguiat text-sm md:text-base ${player === username ? "text-white" : "text-cream/80"}`}>
                        {player}
                      </p>
                    </div>
                    <p className="font-gordon text-cream text-sm md:text-base">
                      {score} pts
                    </p>
                  </div>
                ))}
              </div>

              {isFinalRound ? (
                <button
                  onClick={() => router.push(`/lobby?username=${encodeURIComponent(username)}`)}
                  className="w-full mt-8 px-6 py-3 border-[1.5px] border-cream rounded-full font-gordon text-sm uppercase tracking-[0.2em] cursor-pointer bg-cream text-forest shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition-all duration-300 ease-out hover:bg-transparent hover:text-cream hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,0,0,0.5)]"
                >
                  Exit to Lobby
                </button>
              ) : isHost ? (
                <button
                  onClick={handleNextRound}
                  disabled={loadingNextRound}
                  className="w-full mt-8 px-6 py-3 border-[1.5px] border-cream rounded-full font-gordon text-sm uppercase tracking-[0.2em] cursor-pointer bg-cream text-forest shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition-all duration-300 ease-out hover:bg-transparent hover:text-cream hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,0,0,0.5)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                  {loadingNextRound ? "Loading..." : "Next Round"}
                </button>
              ) : (
                <p className="font-benguiat text-cream/50 text-sm text-center mt-8">
                  Waiting for host to start next round...
                </p>
              )}

              {error && (
                <p className="font-benguiat text-red-400 text-sm text-center mt-3">
                  {error}
                </p>
              )}
            </div>
          </div>
        )}
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
              {roundPrompt || "Record your voice impersonation below."}
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
