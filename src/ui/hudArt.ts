import hudUi from "../assets/hudUi.json";
import type { HudManifest } from "./Hud";

export const HUD_MAN = hudUi as unknown as HudManifest;
export const HUD_BASE = "ui/hud/";

export function hudArtFiles(): string[] {
  const files = new Set<string>();
  for (const s of Object.values(HUD_MAN.states)) files.add(s.plate);
  files.add(HUD_MAN.bars.fill.file);
  files.add(HUD_MAN.scorebar.row.file);
  for (const r of Object.values(HUD_MAN.scorebar.bars)) files.add(r.file);
  files.add(HUD_MAN.scorebar.cap.file);
  for (const r of Object.values(HUD_MAN.scorebar.rows)) files.add(r.file);
  for (const r of Object.values(HUD_MAN.icons)) files.add(r.file);
  for (const r of Object.values(HUD_MAN.flags)) files.add(r.file);
  files.add(HUD_MAN.arrow.file);
  files.add(HUD_MAN.speak.closed.file);
  files.add(HUD_MAN.speak.open.file);
  files.add(HUD_MAN.aimer.line.file);
  files.add(HUD_MAN.aimer.circle.file);
  for (const r of HUD_MAN.head.plates) files.add(r.file);
  files.add(HUD_MAN.head.selected.file);
  for (const f of Object.values(HUD_MAN.head.select.states)) files.add(f);
  for (const f of Object.values(HUD_MAN.song.states)) files.add(f);
  return [...files];
}

export function hudArtUrls(): string[] {
  return hudArtFiles().map((f) => HUD_BASE + f);
}
