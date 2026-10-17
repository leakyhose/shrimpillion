import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Link, Outlet, RouterProvider, createBrowserRouter } from "react-router";
import { FirstName } from "./Diver.tsx";
import { Wordmark } from "./Ocean.tsx";
import { Game } from "./pages/Game.tsx";
import { History } from "./pages/History.tsx";
import { Home } from "./pages/Home.tsx";
import { Round } from "./pages/Round.tsx";
import "./styles.css";

function NotFound() {
  return (
    <div className="page">
      <div className="page-inner">
        <Link to="/"><Wordmark small /></Link>
        <h2>Page not found</h2>
        <p>This trench is empty. Even the shrimp left.</p>
        <div className="link-row"><Link className="btn-quiet" to="/">← PACKS</Link></div>
      </div>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: (
      <>
        <Outlet />
        <FirstName />
        <span className="credit">by <b>Yiming Su</b></span>
      </>
    ),
    children: [
      { path: "/", element: <Home /> },
      { path: "/history", element: <History /> },
      { path: "/r/:roundId", element: <Round /> },
      { path: "/g/:gameId", element: <Game /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
