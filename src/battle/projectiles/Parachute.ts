// 伞降:精英伞兵 —— 抛物线上升 → 到最高点开伞(全力上抛可在屏幕外开伞,比敌机还高)
//        → 缓降途中**垂直向下持续射击**(竖列内士兵/弹药小人/敌机全可命中,不毁地形) → 落地即消失

import type { Battle } from "../Battle";
import type { Team } from "../Soldier";
import type { WeaponDef } from "../../data/weapons";
import { statOf } from "../../data/weapons";
import { GRAVITY } from "./Ballistic";
import { Audio } from "../../core/Audio";
import { Unit, drawChute } from "./GroundUnit";

export class Parachute extends Unit {
  targetX: number;
  chuteOpen = false;
  shootT = 26; // 开伞后第一枪的延迟

  constructor(
    b: Battle,
    team: Team,
    weapon: WeaponDef,
    level: number,
    x: number,
    y: number,
    angle: number,
    v: number,
    targetX: number
  ) {
    super(b, team, weapon, level, x, y, angle, v);
    this.targetX = targetX;
    this.lifeCap = 900;
  }

  step(): void {
    const b = this.b;
    this.age++;
    if (this.age > this.lifeCap) {
      this.remove();
      return;
    }

    if (!this.grounded) {
      if (!this.chuteOpen) {
        // 上升段:重力小,到达最高点即开伞(全力上抛时可在屏幕外开伞,比敌机还高)
        this.vy += GRAVITY * 0.5;
        this.x += this.vx;
        this.y += this.vy;
        this.tumble += 0.12;
        const dx = this.targetX - this.x;
        if (this.vy > -0.5) {
          this.chuteOpen = true;
        }
        if (Math.abs(dx) > 8) this.x += Math.sign(dx) * 0.8;
      } else {
        // 缓降段:横移到目标点上方再下落;垂直向下周期射击(不毁地形)
        this.vy = Math.min(this.vy + GRAVITY * 0.25, 1.15);
        const dx = this.targetX - this.x;
        if (Math.abs(dx) > 3) {
          this.x += Math.sign(dx) * Math.min(1.4, Math.abs(dx));
        }
        this.y += this.vy;
        this.chute = true;
        this.shootDown(b);
      }
      this.x = Math.max(8, Math.min(792, this.x));

      // 直击
      for (const s of b.soldiers) {
        if (!s.alive || s.team === this.team) continue;
        if (hitSoldierL(this.x, this.y - 12, s)) {
          this.landed(b, s.x, s.y);
          return;
        }
      }
      if (b.bridge && b.bridge.solidAt(this.x, this.y)) {
        this.y = b.bridge.deckYAt(this.x)!;
        this.land(b);
        return;
      }
      if (b.terrain.solidAt(this.x, this.y)) {
        this.land(b);
        return;
      }
      if (this.y > b.waterY) {
        b.fx.smoke(this.x, b.waterY - 6, 0.8);
        this.remove();
        return;
      }
      return;
    }
    this.behave(b);
  }

  /** 垂直向下持续射击:命中正下方竖列(±14px)内的一切敌方目标。
   *  能打到飞行敌机靠的是高度差——开伞位置比敌机高,敌机飘过竖列就会被扫中 */
  private shootDown(b: Battle): void {
    this.shootT--;
    if (this.shootT > 0) return;
    this.shootT = 30; // 射速稍快
    const muzzleY = this.y + 10;
    const dmg = statOf(this.weapon, "power", this.level);

    // 找正下方竖列中最近的目标(须在自身下方)
    let hitY = Infinity;
    let victimS: import("../Soldier").Soldier | null = null;
    let victimU: Unit | null = null;
    let victimF: import("../FlyingEnemy").FlyingEnemy | null = null;
    for (const s of b.soldiers) {
      if (!s.alive || s.team === this.team) continue;
      const top = s.y - 40;
      if (Math.abs(s.x - this.x) < 14 && top > this.y && top < hitY) {
        hitY = top;
        victimS = s;
        victimU = null;
        victimF = null;
      }
    }
    for (const u of b.units) {
      if (!u.alive || u.team === this.team) continue;
      if (Math.abs(u.x - this.x) < 14 && u.y > this.y && u.y < hitY) {
        hitY = u.y;
        victimS = null;
        victimU = u;
        victimF = null;
      }
    }
    for (const f of b.flyers) {
      if (!f.alive) continue;
      if (Math.abs(f.x - this.x) < 14 && f.y > this.y && f.y < hitY) {
        hitY = f.y;
        victimS = null;
        victimU = null;
        victimF = f;
      }
    }

    if (victimS) {
      b.fx.text(victimS.x, victimS.y - 52, `-${dmg}`, "#ff6040", 14);
      b.damageSoldier(victimS, dmg, true, false, this.team);
      b.fx.addTracer(this.x, muzzleY, this.x, hitY);
      Audio.play("shoot_b", { vol: 0.5, rate: 1.25 });
      return;
    }
    if (victimU) {
      victimU.hit(dmg);
      b.fx.addTracer(this.x, muzzleY, this.x, hitY);
      Audio.play("shoot_b", { vol: 0.5, rate: 1.25 });
      return;
    }
    if (victimF) {
      victimF.hit(dmg);
      b.fx.addTracer(this.x, muzzleY, this.x, hitY + 10);
      Audio.play("shoot_b", { vol: 0.5, rate: 1.25 });
      return;
    }
    // 竖列无目标:朝地面开枪扬尘
    Audio.play("shoot_b", { vol: 0.4, rate: 1.3 });
    const gy = b.sampleGround(this.x, this.y + 10);
    const endY = gy !== null ? gy : this.y + 200;
    b.fx.addTracer(this.x, muzzleY, this.x, endY);
    if (gy !== null) b.fx.puff(this.x, gy - 4, 0.5);
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.grounded && this.chuteOpen) {
      drawStickmanAt(ctx, this.x, this.y, this.tumble, this.weapon.custom === "elite");
      drawChute(ctx, this.x, this.y);
      return;
    }
    super.render(ctx);
  }
}

import { drawStickman } from "../figures";
import { hitSoldier as hitSoldierL } from "./Ballistic";

function drawStickmanAt(ctx: CanvasRenderingContext2D, x: number, y: number, tumble: number, _elite: boolean): void {
  ctx.save();
  ctx.translate(x, y - 16);
  ctx.rotate(tumble * 0.5);
  ctx.translate(-x, -(y - 16));
  drawStickman(ctx, { x, y: y - 16, facing: 1, equipment: "rifle", walk: -1, scale: 0.8 });
  ctx.restore();
}
