// 落地行走单位(弹药小人):抛物线接近 → 落地 → 行为策略
// 承载 10 种落地行为(护伞/维修/冻结/燃烧/铺冰/刺杀/推挤/定时/挖洞/自爆)

import type { Battle } from "../Battle";
import type { Soldier, Team } from "../Soldier";
import type { WeaponDef } from "../../data/weapons";
import { statOf } from "../../data/weapons";
import { GRAVITY, hitSoldier } from "./Ballistic";
import { explodeAt } from "../effects/Explosion";
import { Audio } from "../../core/Audio";
import { drawStickman, drawBomb, equipOf } from "../figures";

/** 空中飞行阶段的弹药小人(抛物线) */
export class Unit {
  dead = false;
  alive = true;
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded = false;
  hp = 30;
  facing: 1 | -1 = 1;
  age = 0;
  tumble = 0;
  walkPhase = 0;
  // 行为状态
  acted = 0;
  healTotal = 0;
  lifeCap = 700;
  gone = false; // 淡出标记(挖掘沉入等)
  chute = false;
  // 寻敌/徘徊状态
  blockT = 0; // 被地形挡住的时间
  lostTarget = false; // 追不上敌人,改为来回走动
  wanderT = 0;
  pushT = 0; // 推挤剩余时间
  pushing = false;
  digs = 0; // 已挖坑数

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
    // 原版:弹药小人被炸/被打到就死,原地安静消失(刺杀兵等不会爆炸)
    this.alive = false;
    this.remove();
  }

  remove(): void {
    this.dead = true;
  }

  step(): void {
    const b = this.b;
    this.age++;
    if (this.age > this.lifeCap) {
      this.remove();
      return;
    }

    if (!this.grounded) {
      // 空中阶段
      this.vy += GRAVITY * 0.9;
      this.x += this.vx;
      this.y += this.vy;
      this.tumble += 0.18;
      // 降落伞武器(精英伞兵由 Parachute 处理)
      if (this.weapon.launcher === "parachute" && this.vy > 0.4 && this.y > 90) {
        this.chute = true;
        this.vy = Math.min(this.vy, 1.1);
        this.vx *= 0.97;
      }
      // 直击敌人(空中撞上也算)
      for (const s of b.soldiers) {
        if (!s.alive || s.team === this.team) continue;
        if (hitSoldier(this.x, this.y - 12, s)) {
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
        Audio.play("hit", { vol: 0.4, rate: 1.4 });
        this.remove();
        return;
      }
      return;
    }

    // 地面行为(落水即消失)
    if (this.y > b.waterY + 4) {
      b.fx.smoke(this.x, b.waterY - 6, 0.9);
      b.fx.text(this.x, b.waterY - 44, "落水!", "#8fd8ff", 14);
      Audio.play("hit", { vol: 0.4, rate: 0.75 });
      this.remove();
      return;
    }
    this.behave(b);
  }

  land(b: Battle): void {
    this.grounded = true;
    this.vy = 0;
    this.vx = 0;
    this.tumble = 0;
    this.facing = this.pickFacing(b);
    Audio.play("hit", { vol: 0.35, rate: 1.6 });
    this.behave(b);
  }

  landed(b: Battle, _tx: number, _ty: number): void {
    this.x = _tx;
    this.y = _ty;
    this.land(b);
  }

  pickFacing(b: Battle): 1 | -1 {
    const e = nearestEnemy(b, this.x, this.team);
    if (e) return e.x >= this.x ? 1 : -1;
    return 1;
  }

  behave(b: Battle): void {
    switch (this.weapon.custom) {
      case "umbrella": {
        // 挂到玩家头上(护伞跟随玩家)
        const p = b.player;
        if (p && p.alive) {
          p.umbrellaFor = 620;
          b.fx.text(p.x, p.y - 60, "护伞!", "#7fd0ff", 15);
        }
        this.remove();
        break;
      }
      case "repair": {
        const p = b.player;
        if (!p || !p.alive) {
          this.remove();
          break;
        }
        // 走向玩家,接触后持续治疗
        const dx = p.x - this.x;
        if (Math.abs(dx) > 26) {
          this.facing = dx >= 0 ? 1 : -1;
          this.walkGround(b, 1.4);
        } else {
          if (p.hp < p.maxHp && this.healTotal < 40) {
            const amount = Math.min(2, p.maxHp - p.hp);
            p.heal(amount);
            this.healTotal += amount;
            this.acted++;
            if (this.acted % 12 === 0) {
              b.fx.text(p.x, p.y - 56, "+HP", "#68e028", 15);
              b.fx.puff(p.x, p.y - 30, 0.5);
            }
          } else {
            b.fx.puff(this.x, this.y - 16, 0.6);
            this.remove();
          }
        }
        break;
      }
      case "freeze": {
        explodeAt(b, this.x, this.y - 14, {
          power: statOf(this.weapon, "power", this.level),
          hurt: statOf(this.weapon, "hurt", this.level),
          radius: statOf(this.weapon, "radius", this.level),
          team: this.team,
          freeze: 120 + this.level * 40,
          sound: "ice",
          ice: true,
          noCarve: true,
        });
        Audio.play("ice", { vol: 0.8 });
        this.remove();
        break;
      }
      case "burn": {
        explodeAt(b, this.x, this.y - 14, {
          power: statOf(this.weapon, "power", this.level),
          hurt: statOf(this.weapon, "hurt", this.level),
          radius: statOf(this.weapon, "radius", this.level),
          team: this.team,
          burn: true,
          noCarve: true, // 原版燃烧不炸坑
        });
        Audio.play("fire", { vol: 0.7 });
        this.remove();
        break;
      }
      case "ice": {
        // 沿地面走一小段,身后铺冰
        this.walkGround(b, 1.1);
        if (this.age % 9 === 0) {
          b.fxGround.addIce(this.x, this.y, 24);
          b.terrain.paintIce(this.x, this.y - 2, 22);
        }
        if (this.age > 0 && this.acted++ > 55) this.remove();
        break;
      }
      case "stab": {
        // 目标:最近的敌方士兵 或 敌方地面持续存活单位(原版是否分敌我不确定,按只打敌方实现)
        let e = nearestEnemy(b, this.x, this.team);
        if (!e) {
          const u = nearestEnemyUnit(b, this.x, this.team);
          if (u) e = { x: u.x, y: u.y, isUnit: true, ref: u } as any;
        }
        if (e && (e as any).isUnit) {
          const u = (e as any).ref as Unit;
          if (Math.abs(u.x - this.x) <= 20) {
            // 刺杀弹药单位(安静死亡)
            b.fx.puff(u.x, u.y - 14, 0.5);
            b.fx.text(u.x, u.y - 44, "刺!", "#ff6040", 17);
            Audio.play("hit", { vol: 0.7, rate: 1.1 });
            u.hit(statOf(this.weapon, "power", this.level));
            this.remove();
            break;
          }
          this.facing = u.x >= this.x ? 1 : -1;
          const beforeU = this.x;
          this.walkGround(b, 1.7);
          if (Math.abs(this.x - beforeU) < 0.4) this.blockT++;
          else this.blockT = 0;
          if (this.blockT > 50) this.lostTarget = true;
          this.acted++;
          if (this.acted > 300) this.remove();
          break;
        }
        if (e && Math.abs(e.x - this.x) <= 20) {
          b.fx.puff(e.x, e.y - 20, 0.5);
          b.fx.text(e.x, e.y - 56, "刺!", "#ff6040", 17);
          Audio.play("hit", { vol: 0.7, rate: 1.1 });
          b.damageSoldier(e as any, statOf(this.weapon, "power", this.level), true, false, this.team);
          this.remove();
          break;
        }
        this.acted++;
        if (e) {
          // 追敌;被地形挡住超过 50 帧则改为来回走动
          this.facing = e.x >= this.x ? 1 : -1;
          const before = this.x;
          this.walkGround(b, 1.7);
          if (Math.abs(this.x - before) < 0.4) this.blockT++;
          else this.blockT = 0;
          if (this.blockT > 50) this.lostTarget = true;
        }
        if (!e || this.lostTarget) {
          // 来回走动一段距离
          this.wanderT++;
          this.walkGround(b, 1.2);
          if (this.wanderT > 60) {
            this.facing = (this.facing === 1 ? -1 : 1) as 1 | -1;
            this.wanderT = 0;
          }
        }
        if (this.acted > 300) this.remove(); // 原版存活时间较短
        break;
      }
      case "push": {
        const e = nearestEnemy(b, this.x, this.team);
        if (e && this.pushing && this.pushT > 0) {
          // 持续推:沿自己的面向连续推走敌人,无眩晕
          this.pushT--;
          this.facing = e.x >= this.x ? 1 : -1;
          e.pushBy(this.facing * 1.6);
          this.walkGround(b, 1.6);
          if (this.pushT === 60) b.fx.text(this.x, this.y - 56, "嘿咻!", "#ffd040", 16);
          if (this.pushT <= 0 || !e.alive) this.remove();
          break;
        }
        if (e && Math.abs(e.x - this.x) <= 22) {
          // 接触:开始持续推(初始一次微伤害)
          this.pushing = true;
          this.pushT = 90;
          b.damageSoldier(e, statOf(this.weapon, "power", this.level), false, false, this.team);
          Audio.play("hit", { vol: 0.5, rate: 0.8 });
          break;
        }
        this.acted++;
        if (e) {
          this.facing = e.x >= this.x ? 1 : -1;
          const before = this.x;
          this.walkGround(b, 1.7);
          if (Math.abs(this.x - before) < 0.4) this.blockT++;
          else this.blockT = 0;
          if (this.blockT > 50) this.lostTarget = true;
        }
        if (!e || this.lostTarget) {
          // 来回走动寻敌
          this.wanderT++;
          this.walkGround(b, 1.2);
          if (this.wanderT > 60) {
            this.facing = (this.facing === 1 ? -1 : 1) as 1 | -1;
            this.wanderT = 0;
          }
        }
        if (this.acted > 640) this.remove();
        break;
      }
      case "timed": {
        // 行走固定距离后爆炸
        this.walkGround(b, 1.0);
        this.acted++;
        if (this.acted % 25 === 0) Audio.play("clock", { vol: 0.5, maxDur: 0.45 });
        if (this.acted % 20 === 0) {
          b.fx.text(this.x, this.y - 52, "滴答", "#ff8040", 12);
        }
        if (this.acted >= 72) {
          explodeAt(b, this.x, this.y - 14, {
            power: statOf(this.weapon, "power", this.level),
            hurt: statOf(this.weapon, "hurt", this.level),
            radius: statOf(this.weapon, "radius", this.level),
            team: this.team,
          });
          this.remove();
        }
        break;
      }
      case "dig": {
        // 隔一小会挖一个小圆坑,共挖 4 次后消失(原版节奏)
        this.acted++;
        if (this.acted % 28 === 0) {
          b.terrain.carve(this.x, this.y + 9, 10);
          b.fx.puff(this.x + 5, this.y, 0.55);
          Audio.play("hit", { vol: 0.3, rate: 0.7 });
          this.y += 15; // 沉入刚挖出的坑
          this.digs++;
          if (this.digs >= 4 || this.y > b.waterY - 10) {
            if (this.y > b.waterY - 10) b.fx.smoke(this.x, b.waterY - 6, 0.7);
            else b.fx.puff(this.x, this.y - 10, 0.6);
            this.remove();
          }
        }
        break;
      }
      case "suicide": {
        explodeAt(b, this.x, this.y - 14, {
          power: statOf(this.weapon, "power", this.level),
          hurt: statOf(this.weapon, "hurt", this.level),
          radius: statOf(this.weapon, "radius", this.level),
          team: this.team,
        });
        this.remove();
        break;
      }
      case "elite": {
        // 精英伞兵:下落途中已射击完毕,落地即消失(原版逻辑)
        b.fx.puff(this.x, this.y - 14, 0.6);
        this.remove();
        break;
      }
      default:
        // 未知行为:原地消失
        this.remove();
        break;
    }
  }

  /** 贴地行走:上坡≤42 爬 / 下坡≤14 踩 / 更深落差 → 走出去掉落 */
  walkGround(b: Battle, speed: number): void {
    const nx = this.x + this.facing * speed;
    const g = b.sampleGround(nx, this.y - 60);
    if (g === null) return; // 前方悬空,原地停(行为单位不主动跳坑)
    const dy = g - this.y;
    if (dy <= 14 && dy >= -42) {
      this.y = g;
      this.x = nx;
      this.walkPhase += speed * 0.12;
    } else if (dy > 14) {
      // 前方是坑沿:走过去开始掉落
      this.x = nx;
      this.grounded = false;
      this.vy = 0;
      this.vx = this.facing * 0.4;
    }
    // dy < -42 = 撞墙不动
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (this.chute) {
      drawStickman(ctx, { x: this.x, y: this.y, facing: 1, equipment: equipOf(this.weapon), walk: -1, scale: 0.85 });
      drawChute(ctx, this.x, this.y);
      return;
    }
    if (!this.grounded) {
      ctx.save();
      ctx.translate(this.x, this.y - 16);
      ctx.rotate(this.tumble);
      ctx.translate(-this.x, -(this.y - 16));
      drawStickman(ctx, { x: this.x, y: this.y - 16, facing: 1, equipment: equipOf(this.weapon), walk: -1, scale: 0.8 });
      ctx.restore();
      return;
    }
    drawStickman(ctx, {
      x: this.x,
      y: this.y,
      facing: this.facing,
      equipment: equipOf(this.weapon),
      walk: this.walkPhase,
      scale: 0.85,
    });
  }
}

export function drawChute(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const cy = y - 40;
  ctx.fillStyle = "#e86818";
  ctx.strokeStyle = "#1a1208";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, cy, 17, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 15, cy);
  ctx.lineTo(x, y - 30);
  ctx.lineTo(x + 15, cy);
  ctx.lineWidth = 1;
  ctx.stroke();
}

export function drawHpBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hp: number, max: number): void {
  const ratio = Math.max(0, hp / max);
  const color = ratio > 0.55 ? "#40c820" : ratio > 0.25 ? "#e8a808" : "#d82020";
  ctx.fillStyle = "#1a1208";
  ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 6);
  ctx.fillStyle = color;
  ctx.fillRect(x - w / 2, y, w * ratio, 4);
}

export function nearestEnemy(b: Battle, x: number, team: Team): Soldier | null {
  let best: Soldier | null = null;
  let bd = Infinity;
  for (const s of b.soldiers) {
    if (!s.alive || s.team === team) continue;
    const d = Math.abs(s.x - x);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/** 最近的敌方地面持续存活单位(刺杀兵的额外目标) */
export function nearestEnemyUnit(b: Battle, x: number, team: Team): Unit | null {
  let best: Unit | null = null;
  let bd = Infinity;
  for (const u of b.units) {
    if (!u.alive || u.team === team) continue;
    const d = Math.abs(u.x - x);
    if (d < bd) {
      bd = d;
      best = u;
    }
  }
  return best;
}

export { drawBomb };
