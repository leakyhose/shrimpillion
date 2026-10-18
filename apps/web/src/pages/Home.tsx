import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { newDive } from "../api.ts";
import { NameTag } from "../Diver.tsx";
import { Wordmark } from "../Ocean.tsx";
import { PACKS, type Pack } from "../packs.ts";
import { Boat, Fish, Shrimp } from "../sprites.tsx";

/** / — pick a pack. Each pack creates a fresh round and drops you on its begin-descent screen. */
export function Home() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function play(pack: Pack) {
    setBusy(pack.id);
    setError(null);
    try {
      // Fade the packs out while the game is made, then the dive fades in.
      const fade = new Promise((r) => setTimeout(r, 250));
      const gameId = await newDive(pack.round);
      await fade;
      navigate(`/g/${gameId}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <div className={`page${busy ? " leaving" : ""}`}>
      <div className="page-inner">
        <header className="page-head">
          <div className="top-row">
            <Link to="/"><Wordmark small /></Link>
            <NameTag />
          </div>
          <div className="page-sub">Packs · pick your waters</div>
        </header>

        {PACKS.map((pack) => (
          <button key={pack.id} className="pack" disabled={busy !== null} onClick={() => play(pack)}>
            <PackArt badge={pack.badge} />
            <div className="pack-body">
              <div className="pack-title">{pack.title.toUpperCase()}</div>
              <div className="pack-desc">{pack.blurb}</div>
              <div className="pack-cta">{busy === pack.id ? "DESCENDING…" : pack.cta}</div>
            </div>
          </button>
        ))}
        {error && <p className="error">{error}</p>}

        <Link className="btn-quiet divelog-link" to="/history">DIVE LOG ⟲</Link>
      </div>
    </div>
  );
}

function PackArt({ badge }: { badge: string }) {
  return (
    <div className="pack-art" aria-hidden>
      <div className="stars" />
      <div className="moon" />
      <div className="rays" />
      <Boat className="boat" />
      <div className="fishes">
        <Fish style={{ left: "62%", top: 6 }} />
        <Fish style={{ left: "70%", top: 16 }} />
        <Fish style={{ left: "78%", top: 4 }} />
        <Fish style={{ left: "12%", top: 30 }} />
      </div>
      <Shrimp className="diver" />
      <span className="pack-badge">{badge}</span>
    </div>
  );
}
