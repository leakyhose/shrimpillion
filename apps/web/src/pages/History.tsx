import { useState } from "react";
import { Link } from "react-router";
import { api, useApi } from "../api.ts";
import { NameTag } from "../Diver.tsx";
import { Wordmark } from "../Ocean.tsx";
import { packForRound } from "../packs.ts";
import { TierIcon } from "../sprites.tsx";

/** /history — the dive log: every dive you've played, newest first. */
export function History() {
  const stats = useApi("/api/me/stats");
  const first = useApi("/api/me/games?limit=20");
  const [more, setMore] = useState<any[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null | undefined>(undefined);

  const cursor = nextBefore === undefined ? first.data?.nextBefore : nextBefore;
  const games = [...(first.data?.items ?? []), ...more];

  async function loadMore() {
    const r = await api("GET", `/api/me/games?limit=20&before=${encodeURIComponent(cursor!)}`);
    setMore((m) => [...m, ...r.items]);
    setNextBefore(r.nextBefore);
  }

  const s = stats.data;
  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-head">
          <div className="top-row">
            <Link to="/"><Wordmark small /></Link>
            <NameTag />
          </div>
        </header>
        <h2>Dive log</h2>
        {s?.gamesFinished > 0 && (
          <p className="log-sum">
            {s.gamesFinished} {s.gamesFinished === 1 ? "dive" : "dives"} · best {s.bestScore} · avg {s.averageScore}
          </p>
        )}
        {(first.error || stats.error) && <p className="error">{first.error ?? stats.error}</p>}

        {first.data && games.length === 0 && <p>No dives yet. <Link to="/">Take the plunge</Link></p>}
        {games.map((g) => <DiveCard key={g.id} game={g} />)}
        {cursor && <div className="link-row"><button className="btn-quiet" onClick={loadMore}>LOAD MORE</button></div>}

        <div className="link-row"><Link className="btn-quiet" to="/">← PACKS</Link></div>
      </div>
    </div>
  );
}

function DiveCard({ game }: { game: any }) {
  const done = game.status === "finished";
  const date = new Date(game.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <Link className="dive-card" to={`/g/${game.id}`}>
      <div className="dc-head">
        <span className="dc-title">{packForRound(game.round).title.toUpperCase()}</span>
        <span className="dc-date">{date}</span>
      </div>
      <div className="dc-body">
        <div className="dc-score">
          <span className="n">{game.score}</span>
          <span className="of">/{game.maxScore}</span>
          <div className="m">{done ? `-${(game.score * 10).toLocaleString("en-US")}m` : "STILL DIVING ▸"}</div>
        </div>
        <MiniDive slots={game.slots} />
      </div>
    </Link>
  );
}

/** How far each answer sank: a line per prompt, its creature at the bottom. */
function MiniDive({ slots }: { slots: any[] }) {
  return (
    <div className="minidive" aria-hidden>
      {slots.map((s) => {
        const closed = s.status === "answered" || s.status === "timeout";
        const tier = s.status === "answered" ? s.tier : "miss";
        const y = Math.max(3, (s.score ?? 0) * 0.56);
        return (
          <div key={s.slot} className="col" style={{ "--tc": `var(--tier-${tier})` } as React.CSSProperties}>
            {s.score > 0 && <div className="line" style={{ height: y }} />}
            {closed && <TierIcon tier={tier} style={{ top: y }} />}
          </div>
        );
      })}
    </div>
  );
}
