const METAL = "linear-gradient(#b4b0b6, #7e7c80)";

const CSS = `
.sfh-ui { font-family: QTypeSquare-Book, Verdana, sans-serif; color: #fff; }
.sfh-ui ::-webkit-scrollbar { width: 8px; }
.sfh-ui ::-webkit-scrollbar-track { background: rgba(0,0,0,.5); }
.sfh-ui ::-webkit-scrollbar-thumb { background: #7e7c80; }

.sfh-btn {
  appearance: none; -webkit-appearance: none; border: 0; border-radius: 0; margin: 0;
  background: var(--bg, rgba(0,0,0,.6)); color: var(--fg, #fff);
  font-family: QTypeSquare-BlackMajuscles, QTypeSquare-Bold, Verdana, sans-serif;
  text-transform: uppercase; letter-spacing: 1px; line-height: 1.2;
  cursor: pointer; box-sizing: border-box;
}
.sfh-btn:hover { background: var(--bg-over, rgba(0,255,255,.8)); color: var(--fg-over, var(--fg, #fff)); }
.sfh-btn:active { background: rgba(0,0,0,.8); color: #fff; }
.sfh-btn:disabled { opacity: .35; cursor: default; background: var(--bg, rgba(0,0,0,.6)); }
.sfh-btn:focus { outline: none; }
.sfh-btn:focus-visible { outline: 2px solid #ffcc00; outline-offset: -2px; }

.sfh-ui input, .sfh-ui select, .sfh-ui textarea {
  background: #000; color: #fff; border: 0; border-radius: 0;
  border-bottom: 2px solid #7e7c80;
  font-family: QTypeSquare-Book, Verdana, sans-serif;
}
.sfh-ui input:focus, .sfh-ui select:focus, .sfh-ui textarea:focus {
  outline: none; border-bottom-color: #00ffff !important;
}
.sfh-ui select option { background: #000; color: #fff; }
.sfh-ui input[type=checkbox] { accent-color: #ff9900; }

.sfh-band {
  background: #000; color: #fff; border-bottom: 2px solid #7e7c80;
  font-family: Xoireqe, QTypeSquare-Bold, Verdana, sans-serif;
  text-transform: uppercase; letter-spacing: 1px; padding: 3px 6px 2px;
}

.sfh-row { display: flex; align-items: stretch; min-height: 26px; background: #000; margin-top: 3px; }
.sfh-row > .sfh-lab {
  flex: 0 0 52%; display: flex; align-items: center; padding: 0 30px 0 10px;
  background: ${METAL}; color: #111; box-sizing: border-box;
  clip-path: polygon(0 0, 100% 0, calc(100% - 24px) 100%, 0 100%);
  font-family: QTypeSquare-Book, Verdana, sans-serif; letter-spacing: 1px;
}
.sfh-row > .sfh-vals { flex: 1; display: flex; align-items: center; justify-content: flex-end; gap: 2px; padding: 0 4px; }
.sfh-val {
  appearance: none; border: 0; border-radius: 0; background: transparent; color: #fff;
  font-family: QTypeSquare-Bold, Verdana, sans-serif; letter-spacing: 1px;
  padding: 4px 8px; min-width: 30px; cursor: pointer;
}
.sfh-val:hover { background: rgba(255,255,255,.3); }
.sfh-val:active { background: rgba(0,0,0,.8); }
.sfh-val:focus { outline: none; }
.sfh-val:focus-visible { outline: 2px solid #ffcc00; outline-offset: -2px; }
`;

let injected = false;

export function sfhCss(): void {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const st = document.createElement("style");
  st.id = "sfh-css";
  st.textContent = CSS;
  document.head.appendChild(st);
}

export const BTN_TONE = {
  on: "--bg:rgba(255,153,0,.92);--bg-over:#ff9900;",
  go: "--bg:rgba(255,255,0,.3);--bg-over:rgba(255,255,0,.8);",
  cyan: "--bg:rgba(0,255,255,.3);--bg-over:rgba(0,255,255,.8);",
} as const;
