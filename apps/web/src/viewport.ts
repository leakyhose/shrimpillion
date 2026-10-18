/**
 * Keeps the game (and the name popup) inside the part of the screen the on-screen keyboard leaves visible.
 *
 * Android Chrome shrinks the layout viewport itself (index.html asks for interactive-widget=resizes-content),
 * so the fixed stage just gets shorter. iOS Safari only shrinks the *visual* viewport and pans it down to the
 * focused field, which would push the HUD and the prompt card off the top of the screen. While a text field
 * has focus and the keyboard covers part of the page, this sets `html.kb` plus --vv-top / --vv-h, and the
 * fixed layers pin themselves to the visible box (styles.css), so the camera re-frames into it.
 */
export function trackKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const html = document.documentElement;
  let raf = 0;
  const typing = () => {
    const a = document.activeElement;
    return a instanceof HTMLTextAreaElement || (a instanceof HTMLInputElement && !["button", "checkbox", "radio", "submit"].includes(a.type));
  };
  const apply = () => {
    raf = 0;
    // Pinch-zoomed: leave the page alone, the reader is looking around.
    const zoomed = vv.scale > 1.05;
    const covered = html.clientHeight - vv.height;
    if (typing() && !zoomed && covered > 100) {
      html.classList.add("kb");
      html.style.setProperty("--vv-top", `${Math.max(0, Math.round(vv.offsetTop))}px`);
      html.style.setProperty("--vv-h", `${Math.round(vv.height)}px`);
    } else if (html.classList.contains("kb")) {
      html.classList.remove("kb");
      html.style.removeProperty("--vv-top");
      html.style.removeProperty("--vv-h");
    }
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(apply);
  };
  vv.addEventListener("resize", schedule);
  vv.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);
  document.addEventListener("focusin", schedule);
  // Focus can hop straight to another field; wait a beat before deciding the keyboard is gone.
  document.addEventListener("focusout", () => setTimeout(schedule, 50));
}
