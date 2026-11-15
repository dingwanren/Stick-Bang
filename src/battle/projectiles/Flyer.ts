// 自飞单位:Fly Tumbler 飞行骚扰兵 —— 飞到敌人上空悬停骚扰,周期投小炸弹,降低敌人输出

import type { Battle } from "../Battle";
import type { Team } from "../Soldier";
import type { WeaponDef } from "../../data/weapons";
import { statOf } from "../../data/weapons";
import { Ballistic, explodeAtWrap } from "./Ballistic";
import { Audio } from "../../core/Audio";
import { drawStickman, drawBomb } from "../figures";
import { nearestEnemy } from "./GroundUnit";

export class Flyer {
  dead = false;
  x: number;
  y: number;
  hp = 24;
  age = 0;
  phase: "seek" | "hover" | "leave" = "seek";
  hoverX = 400;
  hoverY = 150;
  bob = Math.random() * Math.PI * 2;
  dropTimer = 0;
  vx = 0;
  vy = 0;
  target: { x: number; y: number } | null = null;

  constructor(
    public b: Battle,
    public team: Team,
    public weapon: WeaponDef,
    public level: number,
    x: number,
    y: number,
    angle: number,
    v: number
  ) {
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * v;
    this.vy = Math.sin(angle) * v;
  }

  hit(dmg: number): void {
    if (dmg <= 0 || this.dead) return;
    // 弹药单位:被炸到即毁(一次爆炸)
    this.dead = true;
    this.b.fx.explosion(this.x, this.y, 0.65);
    Audio.play("explosion", { vol: 0.5 });
  }

  step(): void {
    const b = this.b;
    this.age++;
    this.bob += 0.06;

    if (this.phase === "seek") {
      // 飞向最近敌人上空
      const e = nearestEnemy(b, this.x, this.team);
      if (!e) {
        this.phase = "leave";
        return;
      }
      this.target = e;
      this.hoverX = e.x;
      this.hoverY = Math.max(120, e.y - 150);
      const dx = this.hoverX - this.x;
      const dy = this.hoverY - this.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const sp = 2.6;
      this.x += (dx / d) * sp;
      this.y += (dy / d) * sp;
      if (Math.abs(dx) < 14 && Math.abs(dy) < 14) this.phase = "hover";
    } else if (this.phase === "hover") {
      const e = this.target;
      if (!e || (e as any).alive === false) {
        this.phase = "leave";
        return;
      }
      this.hoverX = e.x;
      this.x += (this.hoverX - this.x) * 0.06;
      this.y += (this.hoverY - this.y) * 0.06 + Math.sin(this.bob) * 0.5;

      // 周期骚扰:投小炸弹 + 令敌人迟缓
      this.dropTimer++;
      if (this.dropTimer >= 84) {
        this.dropTimer = 0;
        Audio.play("shoot_a", { vol: 0.4, rate: 1.3 });
        const bomb = new Ballistic(
          { b, team: this.team, weapon: this.weapon, level: this.level },
          this.x,
          this.y + 14,
          Math.PI / 2,
          4,
          1,
          "bomb",
          4
        );
        (bomb as any).__small = true;
        b.projectiles.push(bomb);
        // 骚扰:敌人装填变慢
        if (this.team === "player") {
          for (const s of b.soldiers) {
            if (s.team === "enemy" && s.alive && Math.abs(s.x - this.x) < 80) {
              s.harassFor = 100;
            }
          }
        }
      }
      if (this.age > 540) this.phase = "leave";
    } else {
      // 离场
      this.x += 3.2;
      this.y -= 1.1;
      if (this.x > 830 || this.y < -30) this.dead = true;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    // 喷气小人 + 焰
    drawStickman(ctx, {
      x: this.x,
      y: this.y + 14,
      facing: (this.target?.x ?? this.x) >= this.x ? 1 : -1,
      equipment: "jet",
      walk: -1,
      scale: 0.8,
    });
    // 焰(周期闪烁)
    if (Math.floor(this.age / 4) % 2 === 0) {
      ctx.fillStyle = "#f8b808";
      ctx.beginPath();
      ctx.ellipse(this.x, this.y + 26, 3.5, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export { drawBomb, explodeAtWrap };
