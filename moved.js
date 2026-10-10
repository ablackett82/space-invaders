// "This game has moved into the Arcade" — shown by the game's old home-screen
// app, with a button that copies its scores for the arcade to paste in.
//
// The master copy lives in the arcade repo (moved/moved.js); each game's repo
// carries a copy, loaded from its index.html as
//   <script src="moved.js" data-prefix="pacman." data-name="Pac-Man"></script>
// On iPad every home-screen app keeps its own storage, so the scores can't be
// read across; the clipboard is the way over. The code format is read by the
// arcade's scores.js.
(() => {
  const me = document.currentScript;
  const PREFIX = me.dataset.prefix, NAME = me.dataset.name;
  const ARCADE = new URL('../arcade/', location.href).href;
  if (!PREFIX) return;

  // <encode>
  function transferCode(prefix) {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) data[k] = localStorage.getItem(k);
    }
    const bytes = new TextEncoder().encode(JSON.stringify({ from: prefix, data }));
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return 'ARCADE1:' + btoa(bin);
  }
  // </encode>

  const css = `
    #moved { position: fixed; z-index: 2000; inset: 0; display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.8); font: 16px ui-monospace, Menlo, Consolas, monospace; color: #fff; padding: 16px; }
    #moved .box { max-width: 480px; max-height: 100%; overflow: auto; width: 100%; background: #000; border: 3px solid #3ce6ff; border-radius: 16px; padding: 20px; text-align: center; }
    #moved h2 { margin: 0 0 10px; font-size: 20px; color: #ffe640; }
    #moved p { color: #bbb; line-height: 1.4; margin: 8px 0; }
    #moved ol { text-align: left; color: #ddd; line-height: 1.45; padding-left: 1.5em; margin: 8px 0 4px; }
    #moved b { color: #fff; }
    #moved .addr { color: #3ce6ff; }
    #moved button { display: block; width: 100%; margin: 10px 0 0; font: inherit; font-size: 17px; padding: 12px;
      border-radius: 10px; border: 2px solid #555; background: #111; color: #fff; touch-action: manipulation; }
    #moved .copy { border-color: #ffe640; color: #ffe640; }
    #moved .done { color: #ffe640; min-height: 1.4em; }`;

  // In a home-screen app the scores are walled off and must be copied across by
  // hand; in Safari the arcade is on the same site and already has them.
  const homeScreen = navigator.standalone === true || matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
  const address = location.host + new URL(ARCADE).pathname.replace(/\/$/, '');

  function show() {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    const el = document.createElement('div');
    el.id = 'moved';
    el.innerHTML = homeScreen ? `<div class="box">
      <h2></h2>
      <p>All the games are together in one app now. Your scores can come too:</p>
      <ol>
        <li>Tap <b>Copy my scores</b> below.</li>
        <li>Open <b>Safari</b> and go to <b class="addr"></b>, then tap Share and <b>Add to Home Screen</b>.</li>
        <li>Open the new <b>Arcade</b> icon, tap <b>Bring scores across</b>, then <b>Paste</b>.</li>
        <li>Then you can delete this old icon.</li>
      </ol>
      <button class="copy" type="button">Copy my scores</button>
      <p class="done" role="status"></p>
      <button class="stay" type="button">Keep playing here</button>
    </div>` : `<div class="box">
      <h2></h2>
      <p>All the games are together in one place now, and your scores are already there.</p>
      <p>The new address is <b class="addr"></b></p>
      <button class="copy go" type="button">Go to the Arcade</button>
      <button class="stay" type="button">Keep playing here</button>
    </div>`;
    el.querySelector('h2').textContent = `${NAME} has moved into the Arcade`;
    el.querySelector('.addr').textContent = address;
    const done = el.querySelector('.done');
    // keep touches away from the game underneath
    for (const ev of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'keydown']) el.addEventListener(ev, (e) => e.stopPropagation());

    if (homeScreen) el.querySelector('.copy').addEventListener('click', async () => {
      const code = transferCode(PREFIX);
      let ok = false;
      try { await navigator.clipboard.writeText(code); ok = true; } catch {
        const t = document.createElement('textarea');
        t.value = code; t.style.position = 'fixed'; t.style.opacity = '0';
        document.body.appendChild(t); t.select();
        try { ok = document.execCommand('copy'); } catch { /* no clipboard at all */ }
        t.remove();
      }
      done.textContent = ok ? 'Copied! Now do steps 2 and 3.' : "Couldn't copy on this device.";
    });
    // the code rides along in the link too, in case this browser keeps its storage apart
    else el.querySelector('.go').addEventListener('click', () => { location.href = ARCADE + '#import=' + encodeURIComponent(transferCode(PREFIX)); });
    el.querySelector('.stay').addEventListener('click', () => el.remove());
    document.body.appendChild(el);
  }
  if (document.body) show(); else addEventListener('DOMContentLoaded', show);
})();
