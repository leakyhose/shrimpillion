import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { TIER_LABELS, startGame, useApi } from "../api.ts";
import { Wordmark } from "../Ocean.tsx";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="page">
      <div className="page-inner wide">
        <Link to="/"><Wordmark small /></Link>
        <div className="page-sub">Leaderboard</div>
        {children}
      </div>
    </div>
  );
}

/** Share page: /r/:roundId */
export function Round() {
  const { roundId } = useParams();
  const navigate = useNavigate();
  const { data, error } = useApi(`/api/rounds/${roundId}`);
  const board = useApi(`/api/rounds/${roundId}/leaderboard`);
  const [startError, setStartError] = useState<string | null>(null);

  if (error) return <Frame><p className="error">{error}</p></Frame>;
  if (!data) return <Frame><p>Loading…</p></Frame>;
  const r = data.round;

  async function play() {
    try {
      navigate(`/g/${await startGame(r.id)}`);
    } catch (e) {
      setStartError((e as Error).message);
    }
  }

  return (
    <Frame>
      <h2>{r.title}</h2>
      <p>
        {r.promptCount} prompts{r.createdBy && <> · created by {r.createdBy}</>}
        <br />
        {r.stats.finishedPlays} finished plays
        {r.stats.bestScore != null && <> · best {r.stats.bestScore} · average {r.stats.averageScore}</>}
      </p>

      <div className="link-row">
        {r.yourGame ? (
          <Link className="btn-quiet" to={`/g/${r.yourGame.id}`}>
            {r.yourGame.status === "finished" ? `See your result (${r.yourGame.score})` : "Continue your game →"}
          </Link>
        ) : (
          <button className="btn-quiet" onClick={play}>Play this round</button>
        )}
        <Link className="btn-quiet" to="/">← PACKS</Link>
      </div>
      {startError && <p className="error">{startError}</p>}

      <h3>Leaderboard</h3>
      {board.data && (
        <>
          {!board.data.answersVisible && <p><i>Answers are hidden until you finish this round.</i></p>}
          {board.data.you && <p>You are #{board.data.you.rank} of {board.data.total}.</p>}
          {board.data.entries.length === 0 ? (
            <p>No finished games yet.</p>
          ) : (
            <div className="table-scroll"><table>
              <thead>
                <tr>
                  <th>#</th><th>Player</th><th>Score</th>
                  {board.data.entries[0].slots.map((s: any) => <th key={s.slot}>{s.slot}</th>)}
                </tr>
              </thead>
              <tbody>
                {board.data.entries.map((e: any) => (
                  <tr key={e.gameId} className={board.data.you?.gameId === e.gameId ? "mine" : undefined}>
                    <td>{e.rank}</td>
                    <td><Link to={`/g/${e.gameId}`}>{e.player}</Link></td>
                    <td>{e.score}</td>
                    {e.slots.map((s: any) => (
                      <td key={s.slot} title={s.tier ? TIER_LABELS[s.tier] : s.status}>
                        {s.answer ?? (s.tier ? TIER_LABELS[s.tier] : s.status === "answered" ? "" : "✗")} {s.score ? `(${s.score})` : ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </>
      )}
    </Frame>
  );
}
