import { UT } from "./UT";

export const ARMOR_FIRST: boolean = UT.irand(0, 1) === 0;

const KQ_UNTIL = new Date(2016, 4, 1).getTime();

function open(url: string): void {
  window.open(url, "_blank", "noopener");
}

export function urlSky9Games(now: Date = new Date()): void {
  open(now.getTime() < KQ_UNTIL
    ? "http://knightsquestgame.com/"
    : "http://www.sky9games.com");
}

export function urlArmor(): void {
  open("http://armor.ag/MoreGames");
}

export function urlNotDoppler(): void {
  open("http://www.notdoppler.com/?ref=strikeforceheroes3");
}

export function urlTwitter(): void {
  open("https://twitter.com/sky9games");
}

export function urlYoutube(): void {
  open("https://www.youtube.com/user/JouceTin");
}

export function urlFacebook(now: Date = new Date()): void {
  open(now.getTime() < KQ_UNTIL
    ? "https://www.facebook.com/knightsquestgame"
    : "https://www.facebook.com/pages/Sky9Games/501553356589353");
}

export function playSFH1(): void {
  const url = ARMOR_FIRST
    ? "http://armorgames.com/play/13367/strike-force-heroes"
    : "http://www.notdoppler.com/strikeforceheroes.php?ref=sfh2";
  window.location.href = url;
}

export function urlPhone(): void {
  open("http://goo.gl/odr2a0");
}

export function urlPad(): void {
  open("http://goo.gl/VH8Kcm");
}

export const SOCIAL_LINKS: readonly { label: string; go: () => void }[] = [
  { label: "YT", go: urlYoutube },
  { label: "FB", go: urlFacebook },
  { label: "TW", go: urlTwitter },
];
