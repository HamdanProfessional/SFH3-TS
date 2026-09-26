export interface TextSection {
  readonly title: string;
  readonly lines: readonly string[];
  readonly source: string;
}

export const TIPS: readonly TextSection[] = [
  {
    title: "Hero Status",
    lines: [
      "- As heroes fight battles they become TIRED. Tired heroes will perform "
      + "worse in battle and will eventually become INJURED or CRITICAL.",
      "- Heroes can recover by not battling. Make sure to switch up your squad often!",
      "- Playing a team game without teammates will make your Hero get tired quicker.",
      "IMPORTANT: If you QUIT or LOSE a battle, your squad will NOT get tired. "
      + "Retry as often as you need!",
    ],
    source: "2866, 2867, 2868",
  },
  {
    title: "Recruiting new Heroes",
    lines: [
      "- You can RECRUIT        a new hero once per day (in-game time). "
      + "You can have a maximum of 15 heroes.",
      "- Each recruited hero will have their own flaw, trait, killstreak, "
      + "and set of perks.",
      "- Heroes can be DISMISSED      to free up space and gain additional funds.",
      "- Leveling up your heroes allows you to set which perks they can take "
      + "into battle.",
    ],
    source: "2863, 2864",
  },
  {
    title: "Elements & Status Effects",
    lines: [
      "- IGNITED      enemies quickly take damage over a short time",
      "- POISONED      enemies slowly take damage over a very long time",
      "- CHILLED      enemies will become frozen if they stay chilled long enough",
      "- ELECTRIFIED      enemies take 10% more damage from all sources",
    ],
    source: "2857, 2858-2861",
  },
  {
    title: "WEAPON UPGRADES & BLUEPRINTS",
    lines: [
      "- Blueprints are earned by completing MISSIONS but must be built at the "
      + "WORKSHOP. Building blueprints make the weapons available in the SHOP, "
      + "SLOT MACHINE, or after MISSIONS.",
      "- Weapons in your inventory can be upgraded at the WORKSHOP.",
      "- Upgrading can lower a weapon's LEVEL, so a lvl 31 weapon can be used "
      + "by lvl 30 Heroes.",
    ],
    source: "2870, 2871",
  },
];

export interface CreditGroup {
  readonly role: string;
  readonly entries: readonly string[];
  readonly pairs?: readonly (readonly [string, string])[];
  readonly links?: readonly string[];
  readonly source: string;
}

export const CREDITS: readonly CreditGroup[] = [
  {
    role: "Programming & Art",
    entries: [],
    pairs: [["Justin Goncalves", "Mike Sleva"]],
    source: "2880, 2874, 2877",
  },
  {
    role: "Testing & Feedback",
    entries: ["Wesley Jue"],
    source: "2882, 2881",
  },
  {
    role: "Sponsors",
    entries: ["Armor Games", "Not Doppler"],
    links: [
      "http://armor.ag/MoreGames",
      "http://www.notdoppler.com/?ref=strikeforceheroes3",
    ],
    source: "2883, Logo_LogoBox.as, SD.as:833-841",
  },
  {
    role: "Music",
    entries: [],
    pairs: [
      ["Waterflame", "Rocketrace"],
      ["PictureAndSound", "Future Warfare"],
      ["OutLoudMusic", "Monsieur Mischief"],
      ["Soundroll", "Rush"],
      ["Symphony Of Specters", "Team Strike Force"],
      ["Symphony Of Specters", "Relentless Rage"],
      ["YellowBrick_Media", "Cinematic Trailer Pack (v1)"],
      ["YellowBrick_Media", "Cinematic Trailer Pack (v2)"],
      ["YellowBrick_Media", "Cinematic Trailer Pack (v3)"],
    ],
    source: "2876, 2878, 2879",
  },
];

export const COPYRIGHT = "Copyright © 2015 Sky9 Games. All rights reserved";
