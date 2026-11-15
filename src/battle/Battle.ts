// 战斗场次(一关一次):实体容器 + 采样地面 + 伤害/金钱结算 + 胜负判定 + 渲染编排
// 无尽模式扩展:波次状态机(锯齿难度)+ 补给箱 + 技能CD(Q双发/E散射)+ 多桥桥头要塞

import type { Game, GameSession } from "../core/Game";
import { Terrain } from "./Terrain";
import { Bridge } from "./Bridge";
import { Fx } from "./effects/Fx";
import { GroundFx } from "./effects/GroundFx";
import { explodeAt, type ExplodeOpts } from "./effects/Explosion";
import { Soldier, type SoldierInput, type Team } from "./Soldier";
import { FlyingEnemy } from "./FlyingEnemy";
import { Ai } from "./Ai";
import { Ballistic } from "./projectiles/Ballistic";
import { Unit } from "./projectiles/GroundUnit";
import { Flyer } from "./projectiles/Flyer";
import { Parachute } from "./projectiles/Parachute";
import { SupplyCrate } from "./SupplyCrate";
import { WEAPONS, type WeaponDef } from "../data/weapons";
import type { Level, GroundEnemyCfg, FlyEnemyCfg, Rope } from "../data/levels";
import { Audio } from "../core/Audio";
import { drawAimPreview } from "./AimPreview";

type WaveState = "idle" | "spawning" | "fighting" | "cleared";

interface SpawnOrder {
  delay: number; // 剩余延迟帧(到达 0 且场上敌人未满时放行)
  make: () => void;
}

/** 无尽模式兵种解锁表(按预算随机组合;kit 里的 w = 武器表索引) */
const ENDLESS_ROSTER = [
  { minWave: 1, cost: 60, hp: 100, kit: [] as { w: number; count: number }[] },
  { minWave: 3, cost: 90, hp: 90, kit: [{ w: 3, count: 2 }] }, // 冰冻兵
  { minWave: 5, cost: 110, hp: 110, kit: [{ w: 4, count: 2 }] }, // 燃烧兵
  { minWave: 8, cost: 100, hp: 100, kit: [{ w: 12, count: 2 }] }, // 挖洞兵
  { minWave: 10, cost: 180, hp: 150, kit: [{ w: 3, count: 1 }] }, // 精英
  { minWave: 12, cost: 200, hp: 220, kit: [{ w: 13, count: 1 }] }, // 重装(火箭)
];
const SKILL_CD = { burst: 180, spread: 300 }; // 帧(3s / 5s)
const MAX_ENEMIES = 6; // 全场敌人上限(超出排队补位)

export class Battle {
  terrain: Terrain; // 世界尺寸随关卡(无尽 1600×800,其余 800×600)
  bridges: Bridge[] = [];
  ropes: Rope[] = []; // 攀爬绳(不可摧毁,不挡弹)
  fx = new Fx();
  fxGround = new GroundFx();

  soldiers: Soldier[] = [];
  player: Soldier;
  enemies: Soldier[] = [];
  flyers: FlyingEnemy[] = [];
  playerFlyers: Flyer[] = [];
  units: Unit[] = [];
  projectiles: Ballistic[] = [];
  crates: SupplyCrate[] = []; // 空投补给箱(无尽)
  pendingShots: { t: number; run: () => void }[] = []; // 技能双发的延迟补发

  status: "playing" | "win" | "lose" = "playing";
  endDelay = 0;
  time = 0;
  respawnTimer = 0; // 测试关:敌人全灭后的重生倒计时

  // 无尽波次
  wave = 0;
  kills = 0;
  waveState: WaveState = "idle";
  nextWaveT = 90; // 开场 1.5s 后第一波
  spawnQueue: SpawnOrder[] = [];
  // 技能 CD(帧,击发瞬间起算)
  skillCd = { burst: 0, spread: 0 };

  get isTest(): boolean {
    return this.game.session?.isTest === true;
  }

  get isEndless(): boolean {
    return this.game.session?.isEndless === true;
  }

  get waterY(): number {
    return this.terrain.waterY;
  }

  constructor(
    public game: Game,
    public session: GameSession,
    public level: Level
  ) {
    // 地形(基岩 + 表土双层,世界尺寸由关卡决定)
    this.terrain = new Terrain(level.terrain.width ?? 800, level.terrain.height ?? 600);
    this.terrain.build(level.terrain.platforms, level.terrain.bedrock ?? []);
    this.terrain.waterY = level.terrain.waterY;
    if (level.terrain.bridge) this.bridges.push(new Bridge(level.terrain.bridge));
    for (const bd of level.terrain.bridges ?? []) this.bridges.push(new Bridge(bd));
    for (const r of level.terrain.ropes ?? []) this.ropes.push({ x: r[0], topY: r[1], bottomY: r[2] });

    // 玩家
    this.player = new Soldier(this, "player", true, level.playerStart[0], level.playerStart[1], 100);
    this.player.weaponIdx = session.currentWeapon;
    this.player.weaponLevel = session.weaponLevel(session.currentWeapon);
    this.soldiers.push(this.player);

    // 地面敌人
    for (const cfg of level.enemies.ground) {
      this.addGroundEnemy(cfg);
    }

    // 飞行敌人
    for (const cfg of level.enemies.fly) {
      this.addFlyEnemy(cfg);
    }
  }

  private addGroundEnemy(cfg: GroundEnemyCfg): void {
    // 出生点保护:地面被炸穿(无表土/在水下)时,横向找最近的可用地面
    let x = cfg.x;
    let g = this.terrain.surfaceY(x, 0);
    if (g === null || g >= this.terrain.waterY) {
      outer: for (let d = 10; d <= 320; d += 10) {
        for (const s of [-1, 1]) {
          const gg = this.terrain.surfaceY(x + s * d, 0);
          if (gg !== null && gg < this.terrain.waterY) {
            x = x + s * d;
            g = gg;
            break outer;
          }
        }
      }
    }
    const e = new Soldier(this, "enemy", false, x, g ?? this.level.playerStart[1], cfg.hp);
    e.weaponIdx = 0;
    const ai = new Ai(this, e, cfg);
    (e as any).ai = ai;
    this.enemies.push(e);
    this.soldiers.push(e);
  }

  private addFlyEnemy(cfg: FlyEnemyCfg): void {
    const startX = (cfg.patrol[0] + cfg.patrol[1]) / 2;
    const f = new FlyingEnemy(this, cfg, startX);
    f.weapon = this.makeFallWeapon(cfg.bombPower);
    this.flyers.push(f);
  }

  makeFallWeapon(power: number): WeaponDef {
    return { ...WEAPONS[15], power: [power, power, power], radius: [42, 42, 42] };
  }

  fallWeapon(): WeaponDef {
    return this.flyers[0]?.weapon ?? WEAPONS[15];
  }

  /** 桥面碰撞/查询:多桥取首个命中 */
  bridgeSolidAt(x: number, y: number): boolean {
    for (const br of this.bridges) {
      if (br.solidAt(x, y)) return true;
    }
    return false;
  }

  bridgeDeckYAt(x: number): number | null {
    for (const br of this.bridges) {
      const deck = br.deckYAt(x);
      if (deck !== null) return deck;
    }
    return null;
  }

  /** 采样地面:地形表面 or 存活桥面,取从 fromY 向下最先遇到的 */
  sampleGround(x: number, fromY: number): number | null {
    const candidates: number[] = [];
    const surf = this.terrain.surfaceY(x, Math.max(0, fromY));
    if (surf !== null) candidates.push(surf);
    for (const br of this.bridges) {
      const deck = br.deckYAt(x);
      if (deck !== null && deck >= fromY - 4) candidates.push(deck);
    }
    if (candidates.length === 0) return null;
    return Math.min(...candidates);
  }

  /** 护伞拦截(只保护玩家):返回 true=弹被挡下 */
  checkUmbrella(x: number, y: number, team: Team): boolean {
    const p = this.player;
    if (team === "player" || !p || !p.alive || p.umbrellaFor <= 0) return false;
    const dx = p.x - x;
    const dy = p.y - 52 - y;
    if (dx * dx + dy * dy < 30 * 30) {
      this.fx.puff(x, y, 0.7);
      this.fx.text(x, y - 14, "挡!", "#7fd0ff", 14);
      Audio.play("hit", { vol: 0.4, rate: 1.5 });
      return true;
    }
    return false;
  }

  /** 消耗弹药(fire() 内调用):false=没弹药,取消发射 */
  consumeAmmo(s: Soldier, w: WeaponDef): boolean {
    if (s.team === "enemy") return true; // 敌人 Kit 弹药由 AI 侧扣
    if (w.idx === 0) return true; // 默认∞
    if (this.isTest) return true; // 测试关:无限弹药,不扣减
    const count = this.session.ammo(w.idx);
    if (count <= 0) return false;
    this.session.setAmmo(w.idx, count - 1);
    this.game.weaponBar.refresh();
    this.game.hud.refreshPreview();
    return true;
  }

  /** 结算士兵伤害:命中给钱(直击>溅射,仅玩家侧来源),击杀大额奖励 */
  damageSoldier(s: Soldier, dmg: number, direct: boolean, silentMoney = false, from: Team = s.team): void {
    if (!s.alive || this.status !== "playing") return;
    s.hp -= dmg;
    if (s.team === "enemy" && from === "player" && !silentMoney) {
      const money = direct ? 55 + Math.round(dmg * 0.8) : Math.round(dmg * 1.6);
      this.addMoney(money, s.x, s.y - 52);
    }
    if (s.team === "player") {
      Audio.play("hit", { vol: 0.5, rate: 0.9 });
    } else {
      Audio.play("hit", { vol: 0.4, rate: 1.1 + Math.random() * 0.2 });
    }
    if (s.hp <= 0) s.die(true);
  }

  addMoney(n: number, x?: number, y?: number): void {
    this.session.money += n;
    this.session.score += n;
    this.game.onMoneyChange();
    if (x !== undefined && y !== undefined) {
      this.fx.text(x + (Math.random() - 0.5) * 12, y, `+$${n}`, "#ffd040", 16);
    }
  }

  onSoldierDeath(s: Soldier): void {
    if (s.team === "enemy") {
      this.kills++;
      this.addMoney(250, s.x, s.y - 60);
      this.fx.text(s.x, s.y - 80, "K.O.!", "#ffcc00", 22);
      if (!this.isEndless) {
        const remain = this.enemies.filter((e) => e.alive).length + this.flyers.filter((f) => f.alive).length;
        if (remain === 0 && this.status === "playing") {
          if (this.isTest) {
            this.respawnTimer = 120; // 测试关:敌人重生,不结算过关
          } else {
            this.status = "win";
            this.endDelay = 80;
          }
        }
      }
      // 无尽模式:清波判定由波次状态机(updateWaves)负责
    } else {
      if (this.status === "playing") {
        this.status = "lose";
        this.endDelay = 90;
      }
    }
  }

  onFlyKill(_f: FlyingEnemy): void {
    this.kills++;
    this.addMoney(250, _f.x, _f.y - 30);
    this.fx.text(_f.x, _f.y - 46, "击落!", "#ffcc00", 20);
    if (!this.isEndless) {
      const remain = this.enemies.filter((e) => e.alive).length + this.flyers.filter((f) => f.alive).length;
      if (remain === 0 && this.status === "playing") {
        if (this.isTest) {
          this.respawnTimer = 120;
        } else {
          this.status = "win";
          this.endDelay = 80;
        }
      }
    }
  }

  /** 测试关:按关卡配置重新刷一波敌人 */
  respawnEnemies(): void {
    for (const cfg of this.level.enemies.ground) {
      this.addGroundEnemy(cfg);
    }
    for (const cfg of this.level.enemies.fly) {
      this.addFlyEnemy(cfg);
    }
    this.fx.text(400, 120, "敌人增援抵达!", "#ffcc00", 18);
  }

  explodeAt(x: number, y: number, opts: ExplodeOpts): void {
    explodeAt(this, x, y, opts);
  }

  /** 绳索绘制(地形层,不可摧毁,细绳不挡弹)。
   *  绳贯通世界底,绘制按当前地表剪裁——地形怎么炸,绳都"垂到实际地面",任何时候可达 */
  private drawRopes(ctx: CanvasRenderingContext2D): void {
    for (const r of this.ropes) {
      const g = this.terrain.surfaceY(r.x, r.topY);
      const endY = g !== null ? Math.min(g, r.bottomY) : r.bottomY;
      ctx.strokeStyle = "#5a4426";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(r.x, r.topY);
      ctx.lineTo(r.x, endY);
      ctx.stroke();
      // 结点
      ctx.fillStyle = "#3d2e18";
      for (let y = r.topY + 14; y < endY; y += 26) {
        ctx.fillRect(r.x - 2.5, y, 5, 5);
      }
      // 顶端固定环
      ctx.strokeStyle = "#1a1208";
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x - 3, r.topY - 2, 6, 4);
    }
  }

  // ---------- 技能(无尽模式) ----------

  /** 武装技能:CD 转完且未武装才可按;击发瞬间才起 CD */
  armSkill(kind: "burst" | "spread"): void {
    if (!this.isEndless || this.status !== "playing") return;
    const cd = kind === "burst" ? this.skillCd.burst : this.skillCd.spread;
    const armed = kind === "burst" ? this.player.armedBurst : this.player.armedSpread;
    if (cd > 0 || armed) return;
    if (kind === "burst") this.player.armedBurst = true;
    else this.player.armedSpread = true;
    Audio.play("hit", { vol: 0.4, rate: 1.5 });
    this.fx.text(this.player.x, this.player.y - 66, kind === "burst" ? "双发·装填!" : "散射·装填!", "#ffcc00", 16);
  }

  /** 击发消耗武装时回调:起 CD */
  onSkillTriggered(burst: boolean, spread: boolean): void {
    if (burst) this.skillCd.burst = SKILL_CD.burst;
    if (spread) this.skillCd.spread = SKILL_CD.spread;
  }

  // ---------- 无尽波次 ----------

  aliveEnemyCount(): number {
    return this.enemies.filter((e) => e.alive).length + this.flyers.filter((f) => f.alive).length;
  }

  private updateWaves(): void {
    if (this.waveState === "idle" || this.waveState === "cleared") {
      this.nextWaveT--;
      if (this.nextWaveT <= 0) this.startWave();
      return;
    }
    if (this.waveState === "spawning") {
      for (const o of this.spawnQueue) o.delay--;
      // 上限 6:排头就绪且场上敌人未满才放行
      while (this.spawnQueue.length > 0 && this.spawnQueue[0].delay <= 0 && this.aliveEnemyCount() < MAX_ENEMIES) {
        const o = this.spawnQueue.shift()!;
        o.make();
      }
      if (this.spawnQueue.length === 0) this.waveState = "fighting";
      return;
    }
    // fighting:全灭 → 清波结算
    if (this.aliveEnemyCount() === 0) this.onWaveCleared();
  }

  /** 开新波:预算 → 兵种组合 → 分批刷兵订单 */
  private startWave(): void {
    this.wave++;
    this.waveState = "spawning";
    this.game.showWaveBanner(`第 ${this.wave} 波`);
    // 工兵整地:每波开始表土复原(单层土岛被炸烂会困人/断绳可达性;波内破坏自由)
    if (this.wave > 1) {
      this.terrain.repairSoil();
      this.fx.text(this.player.x, this.player.y - 90, "地形已整修", "#7fd0ff", 15);
    }

    // 锯齿难度:surge(×1.5)/ 喘息(×0.7)
    const surge = this.wave % 3 === 0;
    const breather = !surge && this.wave > 1 && this.wave % 3 === 1;
    let budget = 60 + this.wave * 30;
    if (surge) budget = Math.round(budget * 1.5);
    else if (breather) budget = Math.round(budget * 0.7);

    // 成长压缩(有下限:后期是"难",不是"随机死")
    const hpMul = Math.min(2.2, 1 + 0.1 * this.wave);
    const aimError = Math.max(0.05, 0.14 - this.wave * 0.006);
    const reaction = Math.max(18, 50 - this.wave * 2);
    const aggression = Math.min(0.85, 0.3 + this.wave * 0.03);

    // 飞行敌(6 波起):先从预算里扣
    const flyN = this.wave < 6 ? 0 : Math.min(3, (this.wave >= 12 ? 2 : 1) + (surge ? 1 : 0));
    budget -= flyN * 120;

    // 地面敌:按预算随机抽兵种(买不起最便宜的 60 就停)
    const picks: typeof ENDLESS_ROSTER = [];
    const roster = ENDLESS_ROSTER.filter((r) => this.wave >= r.minWave);
    const minCost = Math.min(...roster.map((r) => r.cost));
    while (budget >= minCost && picks.length < 12) {
      const r = roster[Math.floor(Math.random() * roster.length)];
      if (r.cost > budget) continue;
      picks.push(r);
      budget -= r.cost;
    }

    // 刷兵点(三岛):1-2 波单左岛;3-7 左右外端;8+ 左/右/中岛两端轮换
    const spawnX = (i: number): number => {
      const r = Math.random();
      if (this.wave < 3) return 20 + r * 60; // 左岛外端(顶~500)
      if (this.wave < 8) return Math.random() < 0.5 ? 20 + r * 60 : this.terrain.width - 80 - r * 60;
      const pick = i % 4;
      if (pick === 0) return 20 + r * 60; // 左岛外端
      if (pick === 1) return this.terrain.width - 80 - r * 60; // 右岛外端
      if (pick === 2) return 615 + r * 30; // 中岛西端
      return 950 - r * 30; // 中岛东端
    };

    this.spawnQueue = [];
    let t = 0;
    for (const r of picks) {
      t += 30 + Math.floor(Math.random() * 20);
      const x = spawnX(this.spawnQueue.length);
      const cfg: GroundEnemyCfg = {
        x,
        hp: Math.round(r.hp * hpMul),
        kit: r.kit.map((k) => ({ ...k })),
        aimError,
        reaction,
        aggression,
      };
      this.spawnQueue.push({ delay: t, make: () => this.addGroundEnemy(cfg) });
    }
    // 飞行敌
    for (let i = 0; i < flyN; i++) {
      t += 40 + Math.floor(Math.random() * 30);
      const cfg: FlyEnemyCfg = {
        hp: Math.round(70 * Math.min(2.2, 1 + 0.08 * this.wave)),
        patrol: [100, this.terrain.width - 100],
        bombPower: Math.min(16, 12 + Math.floor(this.wave / 8)),
        reload: Math.max(130, 190 - this.wave * 2),
        bombError: Math.max(0.05, 0.11 - this.wave * 0.003),
      };
      this.spawnQueue.push({
        delay: t,
        make: () => this.addFlyEnemy(cfg),
      });
    }
    // 空降包抄(8 波起,惩罚站桩):降落在玩家身后
    if (this.wave >= 8) {
      const flankN = this.wave >= 14 ? 2 : 1;
      for (let i = 0; i < flankN; i++) {
        t += 80 + Math.floor(Math.random() * 60);
        const tx = this.player.x + (Math.random() < 0.5 ? -1 : 1) * (150 + Math.random() * 250);
        const px = Math.max(30, Math.min(this.terrain.width - 30, tx + (Math.random() - 0.5) * 80));
        this.spawnQueue.push({
          delay: t,
          make: () => {
            const p = new Parachute(this, "enemy", WEAPONS[9], 0, px, 40, Math.PI / 2, 2, tx);
            this.units.push(p);
            this.fx.text(px, 60, "空降!", "#ff8080", 15);
          },
        });
      }
    }
    this.spawnQueue.sort((a, b) => a.delay - b.delay);
  }

  /** 清波:空投补给;每 5 波章节大奖(全弹药+回血+工兵整地+修桥) */
  private onWaveCleared(): void {
    this.waveState = "cleared";
    this.nextWaveT = 240; // 4 秒喘息
    this.spawnCrate();
    if (this.wave % 5 === 0) {
      const s = this.game.session;
      if (s) {
        for (let i = 1; i < WEAPONS.length - 1; i++) {
          if (WEAPONS[i].hidden) continue;
          s.setAmmo(i, WEAPONS[i].carryMax);
        }
        this.game.weaponBar.refresh();
        this.game.hud.refreshPreview();
      }
      this.player.heal(50);
      this.game.showWaveBanner(`第 ${this.wave} 波清空 · 章节补给 · 弹药补满!`);
      this.fx.text(this.player.x, this.player.y - 90, "+50", "#40c820", 20);
    }
  }

  private spawnCrate(): void {
    // 落点采样:必须落在岛上(顶面低于水面),避免箱子落水作废
    let x = this.terrain.width / 2;
    for (let i = 0; i < 24; i++) {
      x = 30 + Math.random() * (this.terrain.width - 60);
      const g = this.terrain.surfaceY(x, 0);
      if (g !== null && g < this.terrain.waterY) break;
    }
    this.crates.push(new SupplyCrate(this, x));
    this.fx.text(this.player.x, this.player.y - 70, "补给空投!", "#ffd040", 16);
  }

  // ---------- 主循环 ----------

  private updatePendingShots(): void {
    if (this.pendingShots.length === 0) return;
    for (const ps of this.pendingShots) ps.t--;
    const ready = this.pendingShots.filter((ps) => ps.t <= 0);
    if (ready.length > 0) {
      for (const ps of ready) ps.run();
      this.pendingShots = this.pendingShots.filter((ps) => ps.t > 0);
    }
  }

  step(input: SoldierInput | null): void {
    this.time++;

    // 测试关:敌人重生
    if (this.respawnTimer > 0) {
      this.respawnTimer--;
      if (this.respawnTimer === 0) this.respawnEnemies();
    }

    if (this.status !== "playing") {
      this.endDelay--;
      this.fx.step();
      // 结束瞬间敌人仍可动画:只推进特效
      if (this.endDelay <= 0) {
        this.game.onBattleEnd(this.status);
        this.endDelay = 99999;
      }
      return;
    }

    // 技能 CD / 延迟补发
    if (this.skillCd.burst > 0) this.skillCd.burst--;
    if (this.skillCd.spread > 0) this.skillCd.spread--;
    this.updatePendingShots();

    // 无尽波次
    if (this.isEndless) this.updateWaves();

    // 补给箱(空降 + 落地)
    for (const c of this.crates) c.step();
    this.crates = this.crates.filter((c) => !c.dead);
    // 拾取判定
    const p = this.player;
    if (p.alive) {
      for (const c of this.crates) {
        if (!c.landed) continue;
        const dx = p.x - c.x;
        const dy = p.y - 20 - (c.y - 10);
        if (dx * dx + dy * dy < 36 * 36) c.collect();
      }
    }

    // 玩家
    p.weaponIdx = this.session.currentWeapon;
    p.weaponLevel = this.session.weaponLevel(this.session.currentWeapon);
    p.update(input ?? undefined);

    // 敌人 AI
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const ai = (e as any).ai as Ai;
      ai.update();
      e.update();
    }

    // 弹丸
    for (const pr of this.projectiles) {
      if (pr.dead) continue;
      if (this.checkUmbrella(pr.x, pr.y, (pr as any).ctx.team)) {
        pr.dead = true;
        continue;
      }
      pr.step(this);
    }
    this.projectiles = this.projectiles.filter((pr) => !pr.dead);

    // 弹药小人单位
    for (const u of this.units) {
      if (u.dead) continue;
      if (!u.grounded && this.checkUmbrella(u.x, u.y, u.team)) {
        u.remove();
        continue;
      }
      u.step();
    }
    this.units = this.units.filter((u) => !u.dead);

    // 飞行敌
    for (const f of this.flyers) f.step();
    this.flyers = this.flyers.filter((f) => f.alive || !f.fallDone); // 清理坠毁完毕的残骸
    // 玩家飞行单位
    for (const f of this.playerFlyers) f.step();
    this.playerFlyers = this.playerFlyers.filter((f) => !f.dead);

    // 地面效果 + 特效
    this.fxGround.step(this);
    this.fx.step();
  }

  render(ctxT: CanvasRenderingContext2D, ctxE: CanvasRenderingContext2D, ctxF: CanvasRenderingContext2D): void {
    const W = this.terrain.width;
    const H = this.terrain.height;
    // 屏震偏移
    const sh = this.fx.shake;
    const sx = sh > 0 ? (Math.random() * 2 - 1) * sh : 0;
    const sy = sh > 0 ? (Math.random() * 2 - 1) * sh : 0;

    ctxT.clearRect(0, 0, W, H);
    ctxE.clearRect(0, 0, W, H);
    ctxF.clearRect(0, 0, W, H);

    ctxT.save();
    ctxT.translate(sx, sy);
    this.terrain.drawLayer(ctxT, this.time);
    this.drawRopes(ctxT);
    for (const br of this.bridges) br.draw(ctxT);
    this.fxGround.render(ctxT);
    ctxT.restore();

    ctxE.save();
    ctxE.translate(sx, sy);
    for (const u of this.units) u.render(ctxE);
    for (const pr of this.projectiles) pr.render(ctxE);
    for (const f of this.flyers) f.render(ctxE);
    for (const f of this.playerFlyers) f.render(ctxE);
    for (const s of this.soldiers) s.render(ctxE);
    for (const c of this.crates) c.render(ctxE);
    ctxE.restore();

    ctxF.save();
    ctxF.translate(sx, sy);
    this.fx.render(ctxF);
    ctxF.restore();

    // 力度指示器(不随屏震)
    drawAimPreview(ctxF, this);
  }
}
