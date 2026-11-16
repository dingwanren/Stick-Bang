// 士兵(炮台单位)—— 玩家与地面敌人共用(对应原版 game.Catapult)
// 原版参数:speed=2px/帧、受击半径17、炮口 pt_fire=(±10,-30)、HP条=HP/max×100

import type { Battle } from "./Battle";
import { WEAPONS, statOf, type WeaponDef } from "../data/weapons";
import type { Rope } from "../data/levels";
import { GRAVITY } from "./projectiles/Ballistic";
import { Ballistic } from "./projectiles/Ballistic";
import { Parachute } from "./projectiles/Parachute";
import { Flyer } from "./projectiles/Flyer";
import { Unit } from "./projectiles/GroundUnit";
import { Audio } from "../core/Audio";
import { drawStickman, drawCannon, drawBomb, drawRocketBody } from "./figures";

export type Team = "player" | "enemy";

export interface SoldierInput {
  left: boolean;
  right: boolean;
  up: boolean; // 接绳/向上爬
  down: boolean; // 向下爬
  mouseX: number;
  mouseY: number;
  fire: boolean; // 本帧点击
  fireTargetX: number; // 点击点(伞降用)
}

export class Soldier {
  alive = true;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  facing: 1 | -1 = 1;
  aimAngle = 0;
  grounded = false;
  vy = 0;
  walkPhase = 0;
  reload = 0; // 剩余装填帧
  reloadMax = 0;
  recoilT = 0;
  frozenFor = 0;
  stunFor = 0;
  harassFor = 0;
  umbrellaFor = 0;
  burningTick = 0;
  deathT = -1;
  fallFrom = 0; // 开始下落时的 y(计算坠落高度/惊呼)
  screamed = false;
  lastPower = 1; // 当前力度(玩家:鼠标距人物远近决定,0.25~1;AI 恒为 1)
  // 技能武装(无尽模式,玩家专用):武装后下一次抛射击发生效,击发才消耗并起 CD
  armedBurst = false; // Q 双发:下一发变 2 连发
  armedSpread = false; // E 散射:下一发变 3 散射
  // 绳索攀爬(无尽模式):onRope 时锁定绳 x、无重力、可开火;←→ 跳离
  onRope: Rope | null = null;
  ropeCd = 0; // 跳离后的短暂不可接绳(防按住↑+←→抖动)

  constructor(
    public b: Battle,
    public team: Team,
    public isPlayer: boolean,
    x: number,
    y: number,
    hp = 100
  ) {
    this.x = x;
    this.y = y;
    this.hp = hp;
    this.maxHp = hp;
    // 初始贴地
    const g = b.sampleGround(x, y - 60);
    if (g !== null) this.y = g;
    this.grounded = true;
    this.fallFrom = this.y;
  }

  /** 当前武器(玩家取 GameSession.currentWeapon,敌人由 AI 设置) */
  weaponIdx = 0;
  weaponLevel = 0;

  weapon(): WeaponDef {
    return WEAPONS[this.weaponIdx];
  }

  heal(n: number): void {
    this.hp = Math.min(this.maxHp, this.hp + n);
  }

  pushBy(dx: number): void {
    // 推挤位移:按地面采样滑动
    const dir = Math.sign(dx) || 1;
    const steps = Math.abs(dx);
    for (let i = 0; i < steps; i++) {
      const nx = this.x + dir;
      const g = this.b.sampleGround(nx, this.y - 60);
      if (g === null) break;
      if (this.y - g < -40) break; // 撞墙停
      this.x = nx;
      this.y = g;
    }
  }

  update(input?: SoldierInput): void {
    if (!this.alive) return;
    const b = this.b;

    // 计时器
    if (this.frozenFor > 0) this.frozenFor--;
    if (this.stunFor > 0) this.stunFor--;
    if (this.harassFor > 0) this.harassFor--;
    if (this.umbrellaFor > 0) this.umbrellaFor--;
    if (this.recoilT > 0) this.recoilT--;
    const slow = this.harassFor > 0 ? 0.66 : 1;
    if (this.reload > 0) this.reload = Math.max(0, this.reload - slow);

    const canAct = this.frozenFor <= 0;

    // 瞄准 + 力度(原版:鼠标距人物越远力度越大,有上限;最小 0)
    if (input && canAct) {
      this.aimAngle = Math.atan2(input.mouseY - (this.y - 30), input.mouseX - this.x);
      this.facing = Math.cos(this.aimAngle) >= 0 ? 1 : -1;
      const dist = Math.hypot(input.mouseX - this.x, input.mouseY - (this.y - 30));
      this.lastPower = Math.min(1, dist / 280);
    }

    // 接绳:站立或下落中按 ↑,绳在附近即接住(可抓下坠)
    if (this.ropeCd > 0) this.ropeCd--;
    if (!this.onRope && this.ropeCd <= 0 && input?.up && canAct && this.stunFor <= 0) {
      const rope = b.ropes.find(
        (r) => Math.abs(this.x - r.x) <= 16 && this.y >= r.topY - 12 && this.y <= r.bottomY + 14
      );
      if (rope) {
        this.onRope = rope;
        this.grounded = false;
        this.vy = 0;
        this.x = rope.x;
        this.fallFrom = this.y;
        this.screamed = false;
      }
    }

    // 移动:攀爬 / 地面行走 / 空中漂移
    if (this.onRope) {
      // ---- 攀爬:↑↓ 爬,←→ 跳离(小跳交给空中物理) ----
      let climb = 0;
      if (input && canAct && this.stunFor <= 0) {
        if (input.up) climb = -1;
        else if (input.down) climb = 1;
        if (input.left || input.right) {
          this.onRope = null;
          this.ropeCd = 18;
          this.vy = -1.6;
          this.x += input.left ? -4 : 4;
          this.fallFrom = this.y;
          this.screamed = false;
        }
      }
      if (this.onRope) {
        if (climb !== 0) this.climbStep(climb);
        else {
          this.x = this.onRope.x;
          this.vy = 0;
        }
      }
    } else {
      let moveDir = 0;
      if (input && canAct && this.stunFor <= 0) {
        if (input.left) moveDir = -1;
        else if (input.right) moveDir = 1;
      }
      if (moveDir !== 0) {
      this.facing = moveDir as 1 | -1;
      if (this.grounded) {
        this.walk(moveDir);
      } else {
        this.x += moveDir * 0.5;
      }
    } else {
      this.walkPhase = 0;
      // 静止也要贴地(冰面/地形被炸后下陷)
      if (this.grounded) {
        const g = b.sampleGround(this.x, this.y - 60);
        if (g === null || g > this.y + 14) {
          // 脚下地面被炸空 / 消失 → 开始下落(不再悬浮)
          this.grounded = false;
          this.vy = 0;
          this.fallFrom = this.y;
          this.screamed = false;
        } else {
          this.y = g; // 贴合(小幅上下)
        }
      }
    }
    }

    // 开火
    if (input?.fire && canAct && this.stunFor <= 0 && this.reload <= 0) {
      this.fire(input.fireTargetX, this.lastPower);
    }

    // 落水即死(无论是否着地:水下弹坑底同样淹死)
    if (this.y > b.waterY + 4) {
      this.drown();
      return;
    }

    // 空中物理(攀爬中无重力)
    if (!this.grounded && !this.onRope) {
      this.vy = Math.min(this.vy + GRAVITY, 9);
      this.y += this.vy;
      const drop = this.y - this.fallFrom;
      if (drop > 36 && !this.screamed) {
        this.screamed = true;
        b.fx.text(this.x, this.y - 46, "啊!!", "#ffffff", 16);
      }
      const g = b.sampleGround(this.x, this.y - this.vy - 2);
      if (g !== null && this.y >= g) {
        this.landAt(g);
      }
    }
  }

  /** 落地:按坠落高度给落地反馈 */
  landAt(g: number): void {
    const b = this.b;
    const drop = g - this.fallFrom;
    this.y = g;
    this.grounded = true;
    this.vy = 0;
    if (drop > 26) {
      b.fx.puff(this.x, this.y - 4, Math.min(1.1, 0.5 + drop / 90));
      Audio.play("hit", { vol: 0.35, rate: 0.8 });
      if (drop > 70) {
        b.fx.addShake(2);
        b.fx.text(this.x, this.y - 48, "咚!", "#c8d8e0", 14);
      }
    } else {
      b.fx.puff(this.x, this.y - 4, 0.5);
    }
    this.screamed = false;
  }

  /** 落水:溅起水花并死亡 */
  drown(): void {
    const b = this.b;
    b.fx.smoke(this.x, b.waterY - 6, 1.15);
    b.fx.puff(this.x - 8, b.waterY - 4, 0.7);
    b.fx.puff(this.x + 8, b.waterY - 4, 0.7);
    Audio.play("hit", { vol: 0.6, rate: 0.75 });
    b.fx.text(this.x, b.waterY - 44, "落水!", "#8fd8ff", 17);
    this.die(false);
  }

  walk(dir: number): void {
    const b = this.b;
    const onIce = b.fxGround.onIce(this.x, this.y);
    const speed = 2 * (onIce ? 0.55 : 1);
    const nx = this.x + dir * speed;
    const g = b.sampleGround(nx, this.y - 60);
    if (g !== null && g <= this.y + 14 && g >= this.y - 42) {
      // 正常贴合:上坡≤42px 自动爬,下坡≤14px 直接踩
      this.y = g;
      this.x = nx;
      this.walkPhase += speed * 0.09;
    } else if (g === null || g > this.y + 14) {
      // 前方悬空或深坑:走出去并开始下落(不再瞬移贴到低处)
      this.x = nx;
      this.grounded = false;
      this.vy = 0;
      this.fallFrom = this.y;
      this.screamed = false;
    }
    // 其余情况 = 撞墙不动
    if (onIce && Math.random() < 0.1) {
      // 冰面打滑漂移
      this.x += dir * 0.6;
    }
  }

  /** 沿绳攀爬一步(玩家输入与 Ai 导航共用):顶部翻上平台;向下爬到实际地表(含炸后坑底)即站住,绝不钻进地形/水里 */
  climbStep(dir: number): void {
    const rope = this.onRope;
    if (!rope) return;
    this.y = Math.max(rope.topY, Math.min(rope.bottomY + 6, this.y + dir * 1.6));
    this.x = rope.x;
    this.vy = 0;
    this.walkPhase += 0.12;
    if (this.y <= rope.topY) {
      // 顶部:翻上平台(从平台顶上方找地表)
      this.onRope = null;
      const g = this.b.sampleGround(rope.x, Math.max(0, rope.topY - 26));
      if (g !== null && g <= rope.topY) {
        this.y = g;
        this.grounded = true;
        this.vy = 0;
        this.fallFrom = this.y;
        this.screamed = false;
      } else {
        this.grounded = false;
        this.fallFrom = this.y; // 绳顶无平台(兜底:直接脱手)
      }
      return;
    }
    if (dir > 0) {
      // 向下爬:碰到当前实际地面(地形怎么炸都算数)就站住脱绳
      const g = this.b.sampleGround(rope.x, this.y - 2);
      if (g !== null && this.y >= g - 1) {
        this.onRope = null;
        this.y = g;
        this.grounded = true;
        this.vy = 0;
        this.fallFrom = this.y;
        this.screamed = false;
        return;
      }
      // 快到水面:强制脱手,不许沿绳爬进水里(想下水请用←→跳离)
      if (this.y >= this.b.waterY - 12) {
        this.onRope = null;
        this.grounded = false;
        this.vy = 0;
        this.fallFrom = this.y;
        return;
      }
      if (this.y >= rope.bottomY + 6) {
        // 绳底(贯通世界底,正常到不了这里)
        this.onRope = null;
        this.grounded = false;
        this.vy = 0;
        this.fallFrom = this.y;
        this.screamed = false;
      }
    }
  }

  /** Ai 导航用:直接接绳(调用方保证位置接近绳底/绳身) */
  tryAttachRope(rope: Rope): boolean {
    if (this.onRope || !this.alive) return false;
    this.onRope = rope;
    this.grounded = false;
    this.vy = 0;
    this.x = rope.x;
    this.y = Math.max(rope.topY, Math.min(rope.bottomY + 6, this.y));
    this.fallFrom = this.y;
    this.screamed = false;
    return true;
  }

  /** 开火:按当前武器类型生成弹丸;power=力度系数(0.25~1,轻抛~全力) */
  fire(targetX = 0, power = 1): void {
    const b = this.b;
    const w = this.weapon();
    const lv = this.weaponLevel;
    const vEff = w.v * power;

    // 弹药检查(没弹药时提示,取消发射;技能武装不消耗)
    const hasAmmo = b.consumeAmmo(this, w);
    if (!hasAmmo) {
      if (this.isPlayer) b.game.toast("No ammunition!");
      return;
    }

    this.reload = w.reload;
    this.reloadMax = w.reload;
    this.recoilT = 7;

    // 炮口位置(枪口闪光由 recoil 渲染的小圆负责,不再用尖刺光束)
    const mx = this.x + Math.cos(this.aimAngle) * 26;
    const my = this.y - 30 + Math.sin(this.aimAngle) * 26;
    Audio.play(shootSoundOf(w), {
      vol: 0.3 + 0.45 * power,
      rate: 1.25 - 0.3 * power, // 小力音调高(噗),大力音调低(砰)
    });

    // 技能武装结算:除修理工外全兵种生效,击发即消耗并通知 Battle 起 CD(威力不削减,纯加弹数)
    const skillable = w.custom !== "repair";
    const burst = skillable && this.armedBurst;
    const spread = skillable && this.armedSpread;
    if (burst || spread) {
      this.armedBurst = false;
      this.armedSpread = false;
      b.onSkillTriggered(burst, spread);
    }
    const ctxObj = { b, team: this.team, weapon: w, level: lv };

    // 双发/散射通用化:按 角度×连发 展开生成(抛射弹/落地单位/伞兵/自飞单位一视同仁)
    const baseAngle = this.aimAngle; // 连发补发也用触发瞬间的角度
    const angles = spread ? [-SPREAD_ANGLE, 0, SPREAD_ANGLE] : [0];
    const spawnOne = (da: number): void => {
      switch (w.launcher) {
        case "ballistic": {
          const body = w.key === "rocket" ? "rocket" : w.key === "ripper" ? "cluster" : "bomb";
          b.projectiles.push(new Ballistic(ctxObj, mx, my, baseAngle + da, vEff, w.gScale, body, 5));
          break;
        }
        case "parachute": {
          // 精英伞兵:目标是点击点(玩家)/玩家位置(敌人);角度差让落点自然散开
          const tx = this.isPlayer ? targetX : b.player ? b.player.x + (Math.random() - 0.5) * 60 : this.x;
          b.units.push(new Parachute(b, this.team, w, lv, mx, my, baseAngle + da, vEff, tx));
          break;
        }
        case "flyer": {
          b.playerFlyers.push(new Flyer(b, this.team, w, lv, mx, my, baseAngle + da, vEff));
          break;
        }
        default: {
          // ground:落地单位(冰冻/燃烧/刺杀/推挤/定时/挖洞),角度差让落点散开
          b.units.push(new Unit(b, this.team, w, lv, mx, my, baseAngle + da, vEff));
        }
      }
    };
    for (const da of angles) spawnOne(da);
    if (burst) {
      // 第二连发延迟 6 帧:同弹道同落点补发一轮(散射则 3 发齐补)
      for (const da of angles) {
        b.pendingShots.push({
          t: 6,
          run: () => {
            if (b.status === "playing") spawnOne(da);
          },
        });
      }
    }
  }

  hit(dmg: number): void {
    this.hp -= dmg;
  }

  /** 给飞行敌人做落点预判用:当前横移速度估计 */
  vxEstimate(): number {
    return this.facing * 2 * 20; // 移速 2px/帧 × 预判 20 帧
  }

  die(withExplosion: boolean): void {
    if (!this.alive) return;
    this.alive = false;
    const b = this.b;
    if (withExplosion) {
      // 死亡爆炸有伤害(原版 nPower 15/4)——别贴脸打
      b.explodeAt(this.x, this.y - 16, {
        power: 15,
        hurt: 4,
        radius: 44,
        team: this.team,
        noCarve: true,
      });
      b.fx.smoke(this.x, this.y - 20, 0.9);
    }
    b.onSoldierDeath(this);
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.alive) return;
    const isPlayer = this.isPlayer;

    // 护伞
    if (this.umbrellaFor > 0) {
      ctx.save();
      ctx.globalAlpha = this.umbrellaFor < 90 ? (Math.floor(this.umbrellaFor / 6) % 2 === 0 ? 0.4 : 1) : 1;
      ctx.fillStyle = "#4aa0e8";
      ctx.strokeStyle = "#1a1208";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(this.x, this.y - 56, 26, 14, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(this.x - 24, this.y - 56);
      ctx.lineTo(this.x, this.y - 44);
      ctx.lineTo(this.x + 24, this.y - 56);
      ctx.stroke();
      ctx.restore();
    }

    // 本体
    drawStickman(ctx, {
      x: this.x,
      y: this.y,
      facing: this.facing,
      cannon: true,
      aim: this.aimAngle,
      walk: this.grounded ? this.walkPhase : -1,
      player: isPlayer,
      cap: !isPlayer,
      frozen: this.frozenFor > 0,
    });

    // 炮口后座视觉:画一个小炮口闪光
    if (this.recoilT > 3) {
      const mx = this.x + Math.cos(this.aimAngle) * 27;
      const my = this.y - 30 + Math.sin(this.aimAngle) * 27;
      ctx.fillStyle = "#ffd040";
      ctx.beginPath();
      ctx.arc(mx, my, 4 + Math.random() * 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // 血条(脚下)
    const ratio = Math.max(0, this.hp / this.maxHp);
    const color = ratio > 0.55 ? "#40c820" : ratio > 0.25 ? "#e8a808" : "#d82020";
    ctx.fillStyle = "#1a1208";
    ctx.fillRect(this.x - 19, this.y + 4, 40, 7);
    ctx.fillStyle = color;
    ctx.fillRect(this.x - 18, this.y + 5, 38 * ratio, 5);

    // 装填条(炮台旁)
    if (this.reload > 0 && this.reloadMax > 0) {
      const p = 1 - this.reload / this.reloadMax;
      ctx.fillStyle = "rgba(10, 20, 24, 0.7)";
      ctx.fillRect(this.x - 16, this.y - 52, 32, 6);
      ctx.fillStyle = "#ffcc00";
      ctx.fillRect(this.x - 15, this.y - 51, 30 * p, 4);
    }

    // 冻结提示
    if (this.frozenFor > 0) {
      ctx.fillStyle = "rgba(160,220,255,0.25)";
      ctx.fillRect(this.x - 14, this.y - 46, 28, 50);
    }
  }

  /** 弹药飞行时的大图标绘制辅助(未用) */
  static drawPreviewProjectile(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    drawBomb(ctx, x, y, 5, 0);
    drawRocketBody(ctx, x, y, 0);
    void drawCannon;
  }
}

function shootSoundOf(w: WeaponDef): string {
  if (w.launcher === "ballistic") return w.key === "rocket" ? "shoot_c" : "shoot_a";
  return "shoot_b";
}

/** 散射扇形半角(±8°) */
const SPREAD_ANGLE = (8 * Math.PI) / 180;

export { statOf };
