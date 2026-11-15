// 敌人 AI 状态机:选位(推进/保持/后撤) → 瞄准(解抛物线+难度误差) → 射击 → 冷却
// 有概率直接用 Kit 里的特殊弹药

import type { Battle } from "./Battle";
import type { Soldier } from "./Soldier";
import { WEAPONS } from "../data/weapons";
import { GRAVITY } from "./projectiles/Ballistic";
import type { GroundEnemyCfg, Rope } from "../data/levels";

type AiState = "idle" | "advance" | "retreat" | "aim" | "fire" | "cooldown" | "nav";

/** 渡河导航:绳底→爬升→天桥横穿→爬下;超时兜底转炮击 */
interface NavPlan {
  phase: "toRope" | "up" | "cross" | "down";
  rope: Rope; // 入口绳
  exit: Rope; // 出口绳(同平台另一根;无则原路下)
  t: number;
}

export class Ai {
  state: AiState = "idle";
  thinkT = 0;
  fireT = 0;
  aimTarget = 0; // 目标角度
  stateT = 0;
  specialChance: number;
  kitAmmo: Map<number, number>;
  stuckT = 0; // 推进被卡(水边/墙)累计帧
  nav: NavPlan | null = null;
  navCd = 0; // 导航完成后冷却(防"爬上去又够不着→再导航"反复横跳)
  stuckProbeT = 0; // toRope 停滞检测
  stuckProbeX = 0;

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
    if (!p || !p.alive) return;
    if (this.state === "nav") {
      this.updateNav();
      return;
    }
    if (this.self.frozenFor > 0 || this.self.stunFor > 0) return;

    this.stateT++;
    if (this.navCd > 0) this.navCd--;
    const dx = p.x - this.self.x;
    const dist = Math.abs(dx);

    // ---- 决策(每 40~80 帧重新思考) ----
    this.thinkT--;
    if (this.thinkT <= 0) {
      this.thinkT = 40 + Math.floor(Math.random() * 40);
      // 炮击够不着 / 玩家在高处 → 尝试渡河导航(爬绳上天路);冷却中只作战
      const sol = solveArc(p.x - this.self.x, p.y - 20 - (this.self.y - 30), this.shotWeapon().v, GRAVITY * this.shotWeapon().gScale);
      const playerHigher = p.y + 90 < this.self.y;
      if (this.navCd <= 0 && (!sol || playerHigher) && Math.random() < 0.4 + this.cfg.aggression * 0.6) {
        const rope = this.pickEntryRope();
        if (rope) {
          this.startNav(rope);
          return;
        }
      }
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
        if (this.stateT < 50 && this.safeToWalk(dir)) {
          this.self.walk(dir);
          this.stuckT = 0;
        } else {
          // 卡在水边/墙前:激进兵攒够耐心就尝试爬绳绕后,否则原地炮击
          this.stuckT++;
          if (this.stuckT > 80 && this.navCd <= 0 && Math.random() < this.cfg.aggression * 0.5) {
            this.stuckT = 0;
            const rope = this.pickEntryRope();
            if (rope) {
              this.startNav(rope);
              break;
            }
          }
          this.state = "aim";
        }
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

  // ---- 渡河导航(三岛天路) ----

  /** 挑入口绳:绳贯通世界底,只看"平台在我头顶上方"且距离最近 */
  private pickEntryRope(): Rope | null {
    const s = this.self;
    const cands = this.b.ropes.filter((r) => r.topY < s.y - 40 && Math.abs(r.x - s.x) > 6);
    if (cands.length === 0) return null;
    cands.sort((a, b) => Math.abs(a.x - s.x) - Math.abs(b.x - s.x));
    return cands[0];
  }

  private startNav(rope: Rope): void {
    // 出口绳 = 同一平台(topY 相同)的另一根,选离玩家近的;没有就原路下
    const exits = this.b.ropes.filter((r) => r !== rope && Math.abs(r.topY - rope.topY) <= 2);
    const p = this.b.player;
    let exit: Rope = rope;
    if (exits.length > 0 && p) {
      exits.sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x));
      exit = exits[0];
    }
    this.nav = { phase: "toRope", rope, exit, t: 0 };
    this.state = "nav";
    this.stateT = 0;
  }

  /** 导航行走:略过 safeToWalk(走向绳是刻意行为),但逐小步探测地面防坠水 */
  private navWalk(targetX: number): boolean {
    const s = this.self;
    const dx = targetX - s.x;
    if (Math.abs(dx) <= 14) return true;
    const dir = (dx > 0 ? 1 : -1) as 1 | -1;
    s.facing = dir;
    const nx = s.x + dir * 2;
    const g = this.b.sampleGround(nx, s.y - 60);
    if (g === null || g > s.y + 42 || g < s.y - 42) return false; // 前方是水/墙 → 停(等超时兜底)
    s.walk(dir);
    return Math.abs(targetX - s.x) <= 14;
  }

  private updateNav(): void {
    const n = this.nav;
    if (!n) {
      this.state = "cooldown";
      return;
    }
    const s = this.self;
    const p = this.b.player;
    n.t++;
    if (n.t > 900 || !p || !p.alive) {
      // 15s 兜底:放弃导航(挂绳中直接脱手坠落,本作无摔伤)
      if (s.onRope) {
        s.onRope = null;
        s.fallFrom = s.y;
      }
      this.state = "cooldown";
      this.thinkT = 60;
      this.stuckT = 0;
      this.navCd = 300; // 短冷却防立刻重触发
      return;
    }
    if (s.frozenFor > 0 || s.stunFor > 0) return;

    switch (n.phase) {
      case "toRope": {
        // 绳贯通世界底:站到绳 x 附近(着地)即可接绳
        if (Math.abs(s.x - n.rope.x) <= 16 && s.grounded) {
          if (s.tryAttachRope(n.rope)) n.phase = "up";
          return;
        }
        // 停滞检测:3 秒位置没变(被水挡住选错了绳)→ 换绳重来
        this.stuckProbeT++;
        if (this.stuckProbeT % 180 === 0) {
          if (Math.abs(s.x - this.stuckProbeX) < 8) {
            const again = this.pickEntryRope();
            if (again && again !== n.rope) {
              this.startNav(again);
              return;
            }
          }
          this.stuckProbeX = s.x;
        }
        this.navWalk(n.rope.x);
        break;
      }
      case "up": {
        if (!s.onRope) {
          n.phase = "cross"; // 顶部转换已自动完成,站上平台
          break;
        }
        s.climbStep(-1);
        break;
      }
      case "cross": {
        if (s.grounded && Math.abs(s.x - n.exit.x) <= 16) {
          if (s.tryAttachRope(n.exit)) n.phase = "down";
          return;
        }
        const dir = (n.exit.x > s.x ? 1 : -1) as 1 | -1;
        s.facing = dir;
        if (s.grounded) s.walk(dir); // 平台面平;走出端点会坠落(无摔伤)
        break;
      }
      case "down": {
        if (!s.onRope) {
          // 底部脱手 → 导航完成,恢复正常作战(长冷却防反复横跳)
          this.state = "cooldown";
          this.thinkT = 40;
          this.stuckT = 0;
          this.navCd = 900;
          return;
        }
        s.climbStep(1);
        break;
      }
    }
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
