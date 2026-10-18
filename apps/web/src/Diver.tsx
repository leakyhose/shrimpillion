import { type FormEvent, useEffect, useState } from "react";
import { DIVER_EVENT, NEW_DIVER_KEY, api, useApi } from "./api.ts";

type Me = { player: { name: string | null; displayName: string } };

/** This browser's player, refreshed whenever it's created or renamed. */
export function useMe() {
  const { data, reload } = useApi<Me>("/api/me");
  useEffect(() => {
    window.addEventListener(DIVER_EVENT, reload);
    return () => window.removeEventListener(DIVER_EVENT, reload);
  }, [reload]);
  return data?.player;
}

/** Top-right: your name and a way to change it. Leaderboards and result links all read it live. */
export function NameTag() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  return (
    <div className="nametag">
      <span className="who">{me?.displayName ?? "…"}</span>
      <button className="btn-box" onClick={() => setOpen(true)}>RENAME</button>
      {open && <NameDialog title="Rename" initial={me?.name ?? ""} dismiss="CANCEL" onClose={() => setOpen(false)} />}
    </div>
  );
}

const isNewDiver = () => localStorage.getItem(NEW_DIVER_KEY) === "1";

/** Asks a brand-new player for a name, once. */
export function FirstName() {
  const [fresh, setFresh] = useState(isNewDiver);
  useEffect(() => {
    const check = () => setFresh(isNewDiver());
    window.addEventListener(DIVER_EVENT, check);
    return () => window.removeEventListener(DIVER_EVENT, check);
  }, []);
  if (!fresh) return null;
  return (
    <NameDialog
      title="Set name"
      initial=""
      dismiss="SKIP"
      onClose={() => {
        localStorage.removeItem(NEW_DIVER_KEY);
        setFresh(false);
      }}
    />
  );
}

function NameDialog(props: { title: string; initial: string; dismiss: string; onClose: () => void }) {
  const [name, setName] = useState(props.initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("PATCH", "/api/me", { name: name.trim() });
      props.onClose();
      window.dispatchEvent(new Event(DIVER_EVENT));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="name-dialog-title" onKeyDown={(e) => e.key === "Escape" && props.onClose()}>
      <form className="modal-box" onSubmit={save}>
        <div id="name-dialog-title" className="modal-title">{props.title.toUpperCase()}</div>
        <p>What should the leaderboards call you?</p>
        <input
          autoFocus
          className="text-input"
          aria-label="Your name"
          placeholder="your name"
          maxLength={32}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn-quiet" onClick={props.onClose}>{props.dismiss}</button>
          <button type="submit" className="btn-pink" disabled={busy || !name.trim()}>SAVE</button>
        </div>
      </form>
    </div>
  );
}
