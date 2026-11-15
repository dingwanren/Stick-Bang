// 敌人 AI 状态机:选位(推进/保持/后撤) → 瞄准(解抛物线+难度误差) → 射击 → 冷却
// 有概率直接用 Kit 里的特殊弹药

import type { Battle } from "./Battle";
import type { Soldier } from "./Soldier";
import { WEAPONS } from "../data/weapons";
import { GRAVITY } from "./projectiles/Ballistic";
import type { GroundEnemyCfg } from "../data/levels";

type AiState = "idle" | "advance" | "retreat" | "aim" | "fire" | "cooldown";

export class Ai {
  state: AiState = "idle";
  thinkT = 0;
  fireT = 0;
  aimTarget = 0; // 目标角度
  stateT = 0;
  specialChance: number;
  kitAmmo: Map<number, number>;

  constructor(
    public b: Battle,
    public self: Soldier,
    public cfg: GroundEnemyCfg
  ) {
    this.kitAmmo = new Map(cfg.kit.map((k) => [k.w, k.count]));
    this.specialChance = Math.min(0.25, 0.12 + cfg.aggression * 0.25);
  }

  update(): void {
    const b = this.b;
    const p = b.player;
    if (!p || !p.alive || this.self.frozenFor > 0 || this.self.stunFor > 0) return;

    this.stateT++;
    const dx = p.x - this.self.x;
    const dist = Math.abs(dx);

    // ---- 决策(每 40~80 帧重新思考) ----
    this.thinkT--;
    if (this.thinkT <= 0) {
      this.thinkT = 40 + Math.floor(Math.random() * 40);
      const roll = Math.random();
      if (dist > 380) {
        this.state = roll < this.cfg.aggression ? "advance" : "aim";
      } else if (dist < 130) {
        this.state = roll < 0.5 ? "retreat" : "aim";
      } else {
        this.state = roll < this.cfg.aggression * 0.6 ? "advance" : roll < 0.15 ? "retreat" : "aim";
      }
      this.stateT = 0;
    }

    // ---- 行为 ----
    switch (this.state) {
      case "advance": {
        const dir = dx >= 0 ? 1 : -1;
        this.self.facing = dir as 1 | -1;
        if (this.stateT < 50 && this.safeToWalk(dir)) this.self.walk(dir);
        else this.state = "aim";
        break;
      }
      case "retreat": {
        const dir = dx >= 0 ? -1 : 1;
        this.self.facing = dir as 1 | -1;
        if (this.stateT < 30 && this.safeToWalk(dir)) this.self.walk(dir);
        else this.state = "aim";
        break;
      }
      case "aim": {
        // 先挑弹药(决定初速),再解抛物线 + 难度误差(作弊权:先解出命中角,再叠加 aimError)
        this.selectWeapon();
        const sol = solveArc(p.x - this.self.x, p.y - 20 - (this.self.y - 30), this.shotWeapon().v, GRAVITY * this.shotWeapon().gScale);
        if (sol) {
          const err = (Math.random() - 0.5) * 2 * this.cfg.aimError;
          this.aimTarget = sol.angle + err;
          this.self.facing = dx >= 0 ? 1 : -1;
          this.self.aimAngle = this.aimTarget;
          this.fireT = this.cfg.reaction + Math.floor(Math.random() * 20);
          this.state = "fire";
        } else {
          this.state = "cooldown";
          this.thinkT = 20;
        }
        break;
      }
      case "fire": {
        // 平滑转向目标角
        let diff = this.aimTarget - this.self.aimAngle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.self.aimAngle += Math.sign(diff) * Math.min(Math.abs(diff), 0.06);
        this.fireT--;
        if (this.fireT <= 0 && Math.abs(diff) < 0.05) {
          // 发射
          this.shoot(p);
          this.state = "cooldown";
          this.thinkT = 20 + Math.floor(Math.random() * 30);
        }
        if (this.stateT > 120) {
          this.state = "cooldown";
          this.thinkT = 30;
        }
        break;
      }
      case "cooldown": {
        if (this.thinkT <= 0) this.thinkT = 0;
        break;
      }
    }
  }

  /** 行走安全探测:前方 26px 处不能是深坑/水(否则站在边缘射击) */
  safeToWalk(dir: number): boolean {
    const b = this.b;
    const probeX = this.self.x + dir * 26;
    const g = b.sampleGround(probeX, this.self.y - 60);
    if (g === null) return false;
    if (g > b.waterY - 40) return false; // 前方贴水
    if (g - this.self.y > 60) return false; // 前方深落差
    return true;
  }

  /** 挑弹药:概率用 Kit 里的特殊弹药(发射前调用) */
  shotWeaponIdx = 0;

  selectWeapon(): void {
    if (Math.random() < this.specialChance && this.kitAmmo.size > 0) {
      const avail = [...this.kitAmmo.entries()].filter(([, c]) => c > 0);
      if (avail.length > 0) {
        const idx = avail[Math.floor(Math.random() * avail.length)][0];
        this.kitAmmo.set(idx, (this.kitAmmo.get(idx) ?? 0) - 1);
        this.shotWeaponIdx = idx;
        return;
      }
    }
    this.shotWeaponIdx = 0;
  }

  shotWeapon() {
    return WEAPONS[this.shotWeaponIdx];
  }

  shoot(p: Soldier): void {
    this.self.weaponIdx = this.shotWeaponIdx;
    this.self.weaponLevel = 0;
    // 面向玩家
    this.self.facing = p.x >= this.self.x ? 1 : -1;
    this.self.reload = 0; // 直接发射(反应间隔已通过 fireT 体现)
    this.self.fire(p.x);
  }
}

/** 抛物线命中解:dx/dy 为屏幕坐标差(dy 向下为正) → 返回屏幕角度(向上为负);取离 45° 最近的解 */
export function solveArc(dx: number, dy: number, v: number, g: number): { angle: number } | null {
  const dxAbs = Math.abs(dx) || 1;
  const yUp = -dy; // 物理坐标:向上为正
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * dxAbs * dxAbs + 2 * yUp * v2);
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const t1 = (v2 - root) / (g * dxAbs);
  const t2 = (v2 + root) / (g * dxAbs);
  const cand = [t1, t2].filter((t) => t > 0);
  if (cand.length === 0) return null;
  // 选离 45° 最近的
  let best = cand[0];
  let bestDiff = Infinity;
  for (const t of cand) {
    const angle = Math.atan(t);
    const diff = Math.abs(angle - Math.PI / 4);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = t;
    }
  }
  const theta = Math.atan(best); // 物理仰角
  // 转屏幕角:vy_screen = -sinθ
  const dir = dx >= 0 ? 1 : -1;
  const screen = dir === 1 ? -theta : Math.PI + theta;
  return { angle: screen };
}
