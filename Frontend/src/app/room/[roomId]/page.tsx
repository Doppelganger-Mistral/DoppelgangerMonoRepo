"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { useParams, useSearchParams } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const WS_URL = API_URL.replace(/^http/, "ws");

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const searchParams = useSearchParams();
  const username = searchParams.get("username") ?? "";

  const [players, setPlayers] = useState<string[]>([]);
  const [maxPlayers, setMaxPlayers] = useState(0);
  const [rounds, setRounds] = useState("3");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/room/${roomId}`);
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setError(body?.detail ?? "Failed to load room");
          setLoading(false);
          return;
        }
        const data = await res.json();
        const room = data.room;
        setPlayers(room.player_list ?? []);
        setMaxPlayers(room.max_players ?? 0);
        setLoading(false);
      } catch {
        if (!cancelled) {
          setError("Could not reach the server");
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;

    const ws = new WebSocket(`${WS_URL}/room/${roomId}/ws`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.event === "player_joined" && msg.player_list) {
          setPlayers(msg.player_list);
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onerror = () => {};
    ws.onclose = () => {};

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [roomId]);

  const handleStartGame = () => {
    console.log("Starting game with", rounds, "rounds");
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-forest">
        <p className="font-gordon text-cream text-xl uppercase tracking-[0.2em]">
          Loading room...
        </p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-forest">
        <p className="font-benguiat text-red-400 text-xl">{error}</p>
      </main>
    );
  }

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

      {/* Room code - top right area */}
      <div className="flex justify-end mt-8 md:mt-12">
        <div className="text-right">
          <p className="font-gordon text-cream text-sm md:text-base uppercase tracking-[0.2em]">
            Room
          </p>
          <p className="font-gordon text-cream text-2xl md:text-3xl tracking-[0.15em]">
            {roomId}
          </p>
        </div>
      </div>

      {/* Players + Controls row */}
      <div className="flex items-center mt-8 md:mt-12 gap-8">
        {/* Player names */}
        <div className="flex flex-wrap gap-6 md:gap-10 lg:gap-14 flex-1">
          {players.map((player) => (
            <p
              key={player}
              className={`font-benguiat text-lg md:text-xl lg:text-2xl ${
                player === username ? "text-white" : "text-cream/80"
              }`}
            >
              {player}
            </p>
          ))}
          {Array.from({ length: maxPlayers - players.length }).map((_, i) => (
            <p
              key={`empty-${i}`}
              className="font-benguiat text-lg md:text-xl lg:text-2xl text-cream/20"
            >
              Waiting...
            </p>
          ))}
        </div>

        {/* Rounds selector */}
        <div className="flex flex-col items-end shrink-0">
          <label className="font-gordon text-cream text-sm md:text-base uppercase tracking-[0.15em] mb-2">
            Rounds:
          </label>
          <select
            value={rounds}
            onChange={(e) => setRounds(e.target.value)}
            className="px-4 py-2 w-28 bg-transparent border-[1.5px] border-cream rounded-lg font-benguiat text-cream text-lg text-center appearance-none cursor-pointer outline-none focus:border-white focus:shadow-[0_0_12px_rgba(213,206,196,0.15)] transition-all duration-200"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n} className="bg-forest text-cream">
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Start Game button */}
      <div className="flex justify-end mt-10 md:mt-14">
        <button
          onClick={handleStartGame}
          className="px-8 md:px-12 py-3 md:py-3.5 border-[1.5px] border-cream rounded-lg font-gordon text-cream text-sm md:text-base uppercase tracking-[0.2em] cursor-pointer bg-transparent shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition-all duration-300 ease-out hover:bg-cream hover:text-forest hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,0,0,0.5)]"
        >
          Start Game
        </button>
      </div>
    </main>
  );
}
