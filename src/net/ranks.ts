export const START_RATING = 1000;
export const PLACEMENT_GAMES = 5;

export function seasonOf(ms = Date.now()): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

export function prevSeason(s: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(s);
  if (!m) return "";
  const y = Number(m[1]);
  const q = Number(m[2]);
  return q === 1 ? `${y - 1}-Q4` : `${y}-Q${q - 1}`;
}

export function seasonLabel(s: string): string {
  return s ? `Season ${s.replace("-", " ")}` : "";
}

const TIERS: readonly [number, string][] = [
  [1500, "MASTER"],
  [1350, "DIAMOND"],
  [1200, "PLATINUM"],
  [1050, "GOLD"],
  [900, "SILVER"],
  [0, "BRONZE"],
];

export const TIER_COLOURS: Record<string, number> = {
  MASTER: 0xff5ad2, DIAMOND: 0x7fe8ff, PLATINUM: 0x6fe0b0,
  GOLD: 0xffd24a, SILVER: 0xd0d8e0, BRONZE: 0xd08850, PLACEMENT: 0xa0a0a0,
};

export function tierOf(rating: number, games: number): string {
  if (games < PLACEMENT_GAMES) return "PLACEMENT";
  for (const [min, name] of TIERS) if (rating >= min) return name;
  return "BRONZE";
}

export function rankLabel(rating: number, games: number): string {
  const t = tierOf(rating, games);
  return t === "PLACEMENT" ? `PLACEMENT ${games}/${PLACEMENT_GAMES}` : `${t} ${Math.round(rating)}`;
}

export function softReset(prev: number | null): number {
  return prev === null ? START_RATING : Math.round(START_RATING + (prev - START_RATING) / 2);
}

export function ratingDelta(mine: number, theirs: number, score: number, games: number): number {
  const expected = 1 / (1 + 10 ** ((theirs - mine) / 400));
  const k = games < PLACEMENT_GAMES ? 48 : 24;
  return Math.round(k * (score - expected));
}
