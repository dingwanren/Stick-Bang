// 抛物线弹丸基类:重力积分 + 逐帧碰撞(士兵直击/桥/地形/水)
// 原版基准:g≈0.3px/帧²,默认初速 15px/帧

import type { Battle } from "../Battle";
import type { Soldier, Team } from "../Soldier";
import type { WeaponDef } from "../../data/weapons";
import { statOf } from "../../data/weapons";
import { explodeAt } from "../effects/Explosion";
import { Audio } from "../../core/Audio";
import { drawBomb, drawRocketBody } from "../figures";

export const GRAVITY = 0.3;

export interface ProjCtx {
  b: Battle;
  team: Team;
  weapon: WeaponDef;
  level: number; // 武器升级等级
}

/** 抛物线弹共同逻辑(默认炮弹/火箭/分裂弹/敌方空投弹) */
export class Ballistic {
  dead = false;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age = 0;
  spin = 0;
  directDone = false;

  constructor(
    public ctx: ProjCtx,
    x: number,
    y: number,
    angle: number,
    v: number,
    public gScale = 1,
    public body: "bomb" | "rocket" | "cluster" | "frag" = "bomb",
    public r = 5
  ) {
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * v;
    this.vy = Math.sin(angle) * v;
  }

  /** 每帧:子步进防穿透 */
  protected integrate(b: Battle, steps = 3): void {
    const w = this.ctx.weapon;
    for (let i = 0; i < steps && !this.dead; i++) {
      this.vy += (GRAVITY * this.gScale) / steps;
      this.x += this.vx / steps;
      this.y += this.vy / steps;
      this.spin += 0.05;
      this.age++;

      // 左右出界(上下不拦截:大力射击可飞出屏幕顶,受重力后回落——原版行为)
      if (this.x < -40 || this.x > 840) {
        this.dead = true;
        return;
      }

      // 直击士兵
      if (!this.directDone) {
        for (const s of b.soldiers) {
          if (!s.alive || s.team === this.ctx.team) continue;
          if (hitSoldier(this.x, this.y, s)) {
            this.directDone = true;
            this.onHitSoldier(b, s);
            this.dead = true;
            return;
          }
        }
        // 直击飞行敌人(对空!)
        for (const f of b.flyers) {
          if (!f.alive || f.team === this.ctx.team) continue;
          const fdx = f.x - this.x;
          const fdy = f.y - this.y;
          if (fdx * fdx + fdy * fdy < 15 * 15) {
            this.directDone = true;
            this.onTerrain(b);
            this.dead = true;
            return;
          }
        }
        // 直击敌方地面单位(弹药小人互杀)
        for (const u of b.units) {
          if (!u.alive || u.team === this.ctx.team) continue;
          const dx = u.x - this.x;
          const dy = u.y - 12 - this.y;
          if (dx * dx + dy * dy < 12 * 12) {
            this.directDone = true;
            u.hit(20);
            this.onTerrain(b);
            this.dead = true;
            return;
          }
        }
      }

      // 桥面 / 地形:碰到即结算(空爆弹在此分裂,其余爆炸)
      const hitSolid =
        (b.bridge !== null && b.bridge.solidAt(this.x, this.y)) ||
        b.terrain.solidAt(this.x, this.y);
      if (hitSolid) {
        this.onTerrain(b);
        this.dead = true;
        return;
      }

      // 落水
      if (this.y > b.waterY) {
        this.dead = true;
        this.onWater(b);
        return;
      }
    }
    // 尾烟
    if (w.trail && this.age % 6 === 0) {
      b.fx.puff(this.x, this.y, 0.45);
    }
  }

  /** 空爆分裂:碰到东西后爆开(视觉),散出 N 个火球碎片(N = 4+升级数);
   *  碎片不反弹、不毁地形,碰到东西直接爆炸造成伤害 */
  private splitIntoFragments(b: Battle): void {
    explodeAt(b, this.x, this.y, {
      power: 0,
      hurt: 0,
      radius: 26,
      team: this.ctx.team,
      noCarve: true,
    });
    const n = 4 + this.ctx.level;
    const spread = 1.0; // 扇形总宽度(弧度)
    // 生成点抬到地表之上,避免碎片出生在土里即刻自爆
    let baseY = this.y;
    let tries = 0;
    while (tries < 30 && (b.terrain.solidAt(this.x, baseY) || (b.bridge !== null && b.bridge.solidAt(this.x, baseY)))) {
      baseY -= 3;
      tries++;
    }
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i - (n - 1) / 2) * (spread / Math.max(1, n - 1)) * 2;
      const px = this.x + (i - (n - 1) / 2) * 8;
      b.projectiles.push(new Ballistic(this.ctx, px, baseY - 2, a, 6.5 + Math.random() * 1.5, 1, "frag", 4));
    }
    Audio.play("explosion", { vol: 0.8, rate: 1.1 });
  }

  /** 分裂弹/碎片弹的爆炸结算:碎片不毁地形 */
  private burst(b: Battle): void {
    if (this.body === "cluster") {
      this.splitIntoFragments(b);
      return;
    }
    if (this.body === "frag") {
      const w = this.ctx.weapon;
      explodeAt(b, this.x, this.y, {
        power: statOf(w, "power", this.ctx.level),
        hurt: statOf(w, "hurt", this.ctx.level),
        radius: statOf(w, "radius", this.ctx.level),
        team: this.ctx.team,
        noCarve: true,
      });
      return;
    }
    explodeAtWrap(b, this.x, this.y, this.ctx.weapon, this.ctx.level, this.ctx.team);
  }

  protected onHitSoldier(b: Battle, _s: Soldier): void {
    this.burst(b);
  }

  protected onTerrain(b: Battle): void {
    this.burst(b);
  }

  protected onWater(b: Battle): void {
    b.fx.smoke(this.x, b.waterY - 6, 0.8);
    b.fx.text(this.x, b.waterY - 24, "扑通!", "#bfe8ff", 14);
    Audio.play("hit", { vol: 0.5, rate: 1.3 });
  }

  step(b: Battle): void {
    this.integrate(b);
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (this.body === "rocket") {
      drawRocketBody(ctx, this.x, this.y, Math.atan2(this.vy, this.vx));
    } else {
      drawBomb(ctx, this.x, this.y, this.r, this.spin);
    }
  }
}

export function explodeAtWrap(
  b: Battle,
  x: number,
  y: number,
  w: WeaponDef,
  level: number,
  team: Team
): void {
  explodeAt(b, x, y, {
    power: statOf(w, "power", level),
    hurt: statOf(w, "hurt", level),
    radius: statOf(w, "radius", level),
    team,
  });
}

export function hitSoldier(px: number, py: number, s: Soldier): boolean {
  // 身体胶囊:从脚到头近似为竖线段,半径 12
  const top = s.y - 38;
  const bot = s.y - 2;
  const cx = Math.max(top, Math.min(bot, py));
  const dx = s.x - px;
  const dy = cx - py;
  return dx * dx + dy * dy < 12 * 12;
}
