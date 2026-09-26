import { UT } from "../core/UT";

export interface MapParticleHost {
  createParticle(
    x: number, y: number, behave: string, hitFrame?: number,
    extra?: Record<string, number> | null, name?: string, sub?: string,
    frame?: number, force?: boolean,
  ): void;
  createEffect(x: number, y: number, name: string): void;
}

export class MapParticles {
  private fc = 0;

  constructor(
    private readonly host: MapParticleHost,
    private readonly map: string,
  ) {}

  mapInit(): void {
    switch (this.map) {
      case "temple":
        for (let i = 0; i < 2; i++) {
          this.host.createParticle(1579, 855, "fairy", 0, null, "fairy", "idle", 1, true);
        }
        for (let i = 0; i < 2; i++) {
          this.host.createParticle(1916, 855, "fairy", 0, null, "fairy", "idle", 1, true);
        }
        for (let i = 0; i < 2; i++) {
          this.host.createParticle(2023, 1087, "fairy", 0, null, "fairy", "idle", 1, true);
        }
        for (let i = 0; i < 2; i++) {
          this.host.createParticle(2506, 754, "fairy", 0, null, "fairy", "idle", 1, true);
        }
        for (let i = 0; i < 2; i++) {
          this.host.createParticle(
            1100 + UT.irand(-20, 20), 986 + UT.irand(-20, 20),
            "fairy", 0, null, "fairy", "idle", UT.irand(2, 6), true,
          );
        }
        for (let i = 0; i < 3; i++) {
          this.host.createParticle(
            1559 + UT.irand(-20, 20), 1020 + UT.irand(-20, 20),
            "fairy", 0, null, "fairy", "idle", UT.irand(2, 6), true,
          );
        }
        for (let i = 0; i < 4; i++) {
          this.host.createParticle(
            576 + UT.irand(-30, 30), 930 + UT.irand(-20, 20),
            "fairy", 0, null, "fairy", "idle", UT.irand(2, 6), true,
          );
        }
        for (let i = 0; i < 3; i++) {
          this.host.createParticle(
            1187 + UT.rand(-40, 40), 1189 + UT.rand(-10, 10),
            "fish", 0, null, "fairy", "fish", 1, true,
          );
        }
        break;
      case "forest":
        for (let i = 0; i < 3; i++) {
          this.host.createParticle(1180, 760, "fairy", 0, null, "fairy", "idle", 2, true);
        }
        for (let i = 0; i < 2; i++) {
          this.host.createParticle(1950, 925, "fairy", 0, null, "fairy", "idle", 2, true);
        }
        for (let i = 0; i < 2; i++) {
          this.host.createParticle(2500, 1040, "fairy", 0, null, "fairy", "idle", 2, true);
        }
        for (let i = 0; i < 2; i++) {
          this.host.createParticle(3245, 1020, "fairy", 0, null, "fairy", "idle", 2, true);
        }
        break;
    }
  }

  enterFrame(): void {
    ++this.fc;
    switch (this.map) {
      case "canyon":
        if (Math.random() < 0.3) {
          this.host.createParticle(
            UT.rand(250, 3500), UT.rand(500, 1500),
            "move", 0, { xSpd: -50, ySpd: 0 }, "wind",
          );
        }
        if (Math.random() < 0.3) {
          this.host.createParticle(
            UT.rand(250, 3500), UT.rand(500, 1500),
            "move", 0, { xSpd: -30, ySpd: 0 }, "dust",
          );
        }
        break;
      case "gorge":
        if (Math.random() < 0.2) {
          this.host.createParticle(
            UT.rand(250, 2900), UT.rand(80, 760),
            "move", 0, { xSpd: -50, ySpd: 0 }, "wind",
          );
        }
        if (Math.random() < 0.2) {
          this.host.createParticle(
            UT.rand(250, 2900), UT.rand(80, 760),
            "move", 0, { xSpd: -30, ySpd: 0 }, "dust",
          );
        }
        break;

      case "factory":
        if (Math.random() < 0.3) {
          this.host.createParticle(
            UT.rand(345, 2750), UT.rand(30, 50),
            "snow", 0, null, "snowFall", "idle", UT.rand(1, 3),
          );
        }
        break;
      case "cavesb":
        if (Math.random() < 0.15) {
          this.host.createParticle(
            UT.rand(60, 3600), UT.rand(150, 200),
            "snow", 0, null, "snowFall", "idle", UT.rand(1, 3),
          );
        }
        if (Math.random() < 0.05) {
          this.host.createEffect(UT.rand(155, 650), UT.rand(630, 800), "shine");
          this.host.createEffect(UT.rand(825, 1640), UT.rand(684, 844), "shine");
          this.host.createEffect(UT.rand(2100, 2800), UT.rand(684, 844), "shine");
          this.host.createEffect(UT.rand(3000, 3550), UT.rand(630, 800), "shine");
        }
        break;

      case "street":
        this.host.createParticle(
          UT.irand(130, 1580), UT.irand(190, 340), "rain", 5, null, "waterdrop");
        this.host.createParticle(
          UT.irand(130, 1580), UT.irand(190, 340), "rain", 5, null, "waterdrop");
        break;
      case "forest":
        this.host.createParticle(
          UT.irand(100, 3500), UT.irand(250, 340), "rain", 5, null, "waterdrop");
        this.host.createParticle(
          UT.irand(100, 3500), UT.irand(250, 340), "rain", 5, null, "waterdrop");
        this.host.createParticle(
          UT.irand(100, 3500), UT.irand(250, 340), "rain", 5, null, "waterdrop");
        break;

      case "caves":
        this.host.createParticle(1380, 1100, "geiser", 0,
          { xSpd: UT.rand(-1, 1), ySpd: UT.rand(-15, -10) }, "Ice");
        this.host.createParticle(1380, 1100, "geiser", 0,
          { xSpd: UT.rand(-1, 1), ySpd: UT.rand(-15, -10) }, "Ice");
        if (this.fc % 15 === 0) {
          this.host.createParticle(1160, 582, "waterdrop", 10, null, "waterdrop");
        }
        if (this.fc % 16 === 0) {
          this.host.createParticle(926, 300, "waterdrop", 10, null, "waterdrop");
        }
        if (this.fc % 18 === 0) {
          this.host.createParticle(2600, 900, "waterdrop", 10, null, "waterdrop");
        }
        if (this.fc % 13 === 0) {
          this.host.createParticle(1190, 800, "waterdrop", 10, null, "waterdrop");
        }
        if (this.fc % 10 === 0) {
          this.host.createParticle(1450, 245, "waterdrop", 10, null, "waterdrop");
        }
        break;

      case "junkyard":
        if (Math.random() < 0.1) {
          for (let i = 0; i < UT.irand(3, 10); i++) {
            this.host.createParticle(1510, 340, "spark", 10, { xSpd: UT.rand(0, 3) }, "ember");
          }
        }
        if (Math.random() < 0.1) {
          for (let i = 0; i < UT.irand(3, 10); i++) {
            this.host.createParticle(1790, 630, "spark", 10, { xSpd: UT.rand(-3, 0) }, "ember");
          }
        }
        if (Math.random() < 0.1) {
          for (let i = 0; i < UT.irand(3, 10); i++) {
            this.host.createParticle(670, 650, "spark", 10, { xSpd: UT.rand(0, 3) }, "ember");
          }
        }
        break;
      case "construction":
        this.host.createParticle(
          3003 + UT.rand(-30, 30), 1276, "move", 0,
          { xSpd: 0, ySpd: -10 }, "gas_big", "idle");
        this.host.createParticle(
          1337 + UT.rand(-30, 30), 1090, "move", 0,
          { xSpd: 0, ySpd: -10 }, "gas_big", "idle");
        this.host.createParticle(
          1407 + UT.rand(-30, 30), 1090, "move", 0,
          { xSpd: 0, ySpd: -10 }, "gas_big", "idle");
        if (Math.random() < 0.1) {
          for (let i = 0; i < UT.irand(3, 10); i++) {
            this.host.createParticle(1318, 961, "spark", 10, null, "ember");
          }
        }
        if (Math.random() < 0.1) {
          for (let i = 0; i < UT.irand(3, 10); i++) {
            this.host.createParticle(945, 1071, "spark", 10, { xSpd: UT.rand(-6, -3) }, "ember");
          }
        }
        break;
      case "cqc":
        if (Math.random() < 0.2) {
          for (let i = 0; i < UT.irand(5, 20); i++) {
            this.host.createParticle(230, 182, "spark", 10, { xSpd: UT.rand(0, 3) }, "ember");
          }
        }
        if (Math.random() < 0.2) {
          for (let i = 0; i < UT.irand(5, 20); i++) {
            this.host.createParticle(1175, 350, "spark", 10, { xSpd: UT.rand(-5, 0) }, "ember");
          }
        }
        break;

      case "frigate":
        if (this.fc % 15 === 0) {
          this.host.createParticle(890, 788, "waterdrop", 10, null, "waterdrop");
        }
        if (this.fc % 16 === 0) {
          this.host.createParticle(1048, 788, "waterdrop", 10, null, "waterdrop");
        }
        if (this.fc % 18 === 0) {
          this.host.createParticle(1657, 754, "waterdrop", 10, null, "waterdrop");
        }
        if (this.fc % 13 === 0) {
          this.host.createParticle(2111, 788, "waterdrop", 10, null, "waterdrop");
        }
        if (this.fc % 10 === 0) {
          this.host.createParticle(2437, 788, "waterdrop", 10, null, "waterdrop");
        }
        if (Math.random() < 0.3) {
          this.host.createParticle(
            UT.rand(400, 3300), UT.rand(200, 940),
            "move", 0, { xSpd: -50, ySpd: 0 }, "wind",
          );
        }
        break;

      case "volcano":
        if (Math.random() < 0.2) {
          this.host.createParticle(
            UT.rand(870, 1090), UT.rand(1290, 1300), "move", 0,
            { xSpd: UT.rand(-1, 1), ySpd: UT.rand(-1, -2) }, "flame",
          );
        }
        if (Math.random() < 0.2) {
          this.host.createParticle(
            UT.rand(1320, 1490), UT.rand(1300, 1330), "move", 0,
            { xSpd: UT.rand(-1, 1), ySpd: UT.rand(-1, -2) }, "flame",
          );
        }
        if (Math.random() < 0.2) {
          this.host.createParticle(
            UT.rand(1700, 1940), UT.rand(1280, 1300), "move", 0,
            { xSpd: UT.rand(-1, 1), ySpd: UT.rand(-1, -2) }, "flame",
          );
        }
        break;
    }
  }
}
