"use client";

import { useState } from "react";
import Image from "next/image";
import { useSearchParams, useRouter } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function Modal({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-forest border-[1.5px] border-cream rounded-2xl p-8 md:p-10 w-[90%] max-w-md shadow-[0_8px_40px_rgba(0,0,0,0.6)]"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export default function Lobby() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const username = searchParams.get("username") ?? "";

  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [maxPlayers, setMaxPlayers] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createdRoomCode, setCreatedRoomCode] = useState("");
  const [showRoomCode, setShowRoomCode] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCreateRoom = async () => {
    if (!maxPlayers || Number(maxPlayers) < 2 || !username) return;

    setCreating(true);
    setCreateError("");

    try {
      const res = await fetch(`${API_URL}/room/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          max_players: Number(maxPlayers),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setCreateError(body?.detail ?? "Failed to create room");
        setCreating(false);
        return;
      }

      await res.json();
      setCreating(false);

      const codeRes = await fetch(
        `${API_URL}/room/code?username=${encodeURIComponent(username)}`
      );
      if (!codeRes.ok) {
        const body = await codeRes.json().catch(() => null);
        setCreateError(body?.detail ?? "Room created but failed to fetch code");
        return;
      }
      const codeData = await codeRes.json();
      setCreatedRoomCode(codeData.room_id);
      setShowRoomCode(true);
    } catch {
      setCreateError("Could not reach the server");
      setCreating(false);
    }
  };

  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");

  const handleJoinRoom = async () => {
    if (roomCode.length !== 6 || !username) return;

    setJoining(true);
    setJoinError("");

    try {
      const res = await fetch(`${API_URL}/room/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: roomCode,
          username,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setJoinError(body?.detail ?? "Failed to join room");
        setJoining(false);
        return;
      }

      setShowJoin(false);
      setRoomCode("");
      setJoining(false);
      router.push(`/room/${roomCode}?username=${encodeURIComponent(username)}`);
    } catch {
      setJoinError("Could not reach the server");
      setJoining(false);
    }
  };

  const inputClasses =
    "w-full mt-4 px-4 py-3 bg-transparent border-[1.5px] border-cream rounded-lg font-benguiat text-cream text-lg text-center tracking-widest outline-none placeholder:text-cream/40 focus:border-white focus:shadow-[0_0_12px_rgba(213,206,196,0.15)] transition-all duration-200";

  const modalBtnClasses =
    "w-full mt-6 px-6 py-3 border-[1.5px] border-cream rounded-full font-gordon text-sm uppercase tracking-[0.2em] cursor-pointer shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition-all duration-300 ease-out hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,0,0,0.5)]";

  return (
    <main className="flex flex-col min-h-screen items-center bg-forest overflow-hidden">
      {/* Top Content */}
      <div className="flex flex-col items-center pt-16 md:pt-24 lg:pt-28 px-6">
        <Image
          src="/titlefont.svg"
          alt="Doppelgänger"
          width={800}
          height={160}
          className="w-[80vw] max-w-[700px] h-auto drop-shadow-[0_3px_6px_rgba(0,0,0,0.5)]"
          priority
        />

        <div className="flex gap-4 md:gap-6 mt-8 md:mt-10">
          <button
            onClick={() => setShowCreate(true)}
            className="px-6 md:px-10 lg:px-12 py-2.5 md:py-3 lg:py-3.5 border-[1.5px] border-cream rounded-full font-gordon text-cream text-xs md:text-sm uppercase tracking-[0.2em] cursor-pointer bg-transparent shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition-all duration-300 ease-out hover:bg-cream hover:text-forest hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,0,0,0.5)]"
          >
            Create Room
          </button>
          <button
            onClick={() => setShowJoin(true)}
            className="px-6 md:px-10 lg:px-12 py-2.5 md:py-3 lg:py-3.5 border-[1.5px] border-cream rounded-full font-gordon text-cream text-xs md:text-sm uppercase tracking-[0.2em] cursor-pointer bg-transparent shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition-all duration-300 ease-out hover:bg-cream hover:text-forest hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,0,0,0.5)]"
          >
            Join Room
          </button>
        </div>
      </div>

      {/* Abbey Road Image at Bottom */}
      <div className="mt-auto w-full flex justify-center pointer-events-none select-none">
        <Image
          src="/abbeyroad.svg"
          alt="Abbey Road"
          width={900}
          height={400}
          className="w-[70vw] max-w-[800px] h-auto"
          priority
        />
      </div>

      {/* Create Room Modal */}
      <Modal open={showCreate} onClose={() => { if (!showRoomCode) { setShowCreate(false); setCreateError(""); } }}>
        {!showRoomCode ? (
          <>
            <h2
              className="font-gordon text-cream uppercase text-center drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]"
              style={{ fontSize: "clamp(1.4rem, 2.5vw, 2rem)" }}
            >
              Create Room
            </h2>
            <p className="font-benguiat text-white/80 text-center text-sm mt-2">
              How many players can join?
            </p>
            <select
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(e.target.value)}
              className={`${inputClasses} appearance-none cursor-pointer`}
              autoFocus
            >
              <option value="" disabled className="bg-forest text-cream/40">
                Select max players
              </option>
              {[3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n} className="bg-forest text-cream">
                  {n} Players
                </option>
              ))}
            </select>
            <button
              onClick={handleCreateRoom}
              disabled={!maxPlayers || creating}
              className={`${modalBtnClasses} bg-cream text-forest hover:bg-transparent hover:text-cream disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100`}
            >
              {creating ? "Creating..." : "Create"}
            </button>
            {createError && (
              <p className="font-benguiat text-red-400 text-sm text-center mt-3">
                {createError}
              </p>
            )}
          </>
        ) : (
          <>
            <h2
              className="font-gordon text-cream uppercase text-center drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]"
              style={{ fontSize: "clamp(1.4rem, 2.5vw, 2rem)" }}
            >
              Room Created
            </h2>
            <p className="font-benguiat text-white/80 text-center text-sm mt-2">
              Share this code with other players
            </p>
            <p className="font-gordon text-cream text-center text-4xl md:text-5xl tracking-[0.3em] mt-6 select-all">
              {createdRoomCode}
            </p>
            <button
              onClick={() => {
                navigator.clipboard.writeText(createdRoomCode);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className={`${modalBtnClasses} bg-transparent text-cream hover:bg-cream hover:text-forest`}
            >
              {copied ? "Copied!" : "Copy Code"}
            </button>
            <button
              onClick={() => {
                setShowCreate(false);
                setShowRoomCode(false);
                setMaxPlayers("");
                router.push(`/room/${createdRoomCode}?username=${encodeURIComponent(username)}`);
              }}
              className={`${modalBtnClasses} bg-cream text-forest hover:bg-transparent hover:text-cream`}
            >
              Enter Room
            </button>
          </>
        )}
      </Modal>

      {/* Join Room Modal */}
      <Modal open={showJoin} onClose={() => { setShowJoin(false); setJoinError(""); }}>
        <h2
          className="font-gordon text-cream uppercase text-center drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]"
          style={{ fontSize: "clamp(1.4rem, 2.5vw, 2rem)" }}
        >
          Join Room
        </h2>
        <p className="font-benguiat text-white/80 text-center text-sm mt-2">
          Enter the 6-digit room code
        </p>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={roomCode}
          onChange={(e) => {
            const val = e.target.value.replace(/\D/g, "");
            if (val.length <= 6) setRoomCode(val);
            if (joinError) setJoinError("");
          }}
          placeholder="000000"
          className={inputClasses}
          autoFocus
        />
        <button
          onClick={handleJoinRoom}
          disabled={roomCode.length !== 6 || joining}
          className={`${modalBtnClasses} bg-cream text-forest hover:bg-transparent hover:text-cream disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100`}
        >
          {joining ? "Joining..." : "Join"}
        </button>
        {joinError && (
          <p className="font-benguiat text-red-400 text-sm text-center mt-3">
            {joinError}
          </p>
        )}
      </Modal>
    </main>
  );
}
