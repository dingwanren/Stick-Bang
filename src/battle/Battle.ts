// 战斗场次(一关一次):实体容器 + 采样地面 + 伤害/金钱结算 + 胜负判定 + 渲染编排

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
import { WEAPONS, type WeaponDef } from "../data/weapons";
import type { Level } from "../data/levels";
import { Audio } from "../core/Audio";
import { drawAimPreview } from "./AimPreview";

export class Battle {
  terrain = new Terrain();
  bridge: Bridge | null = null;
  fx = new Fx();
  fxGround = new GroundFx();

  soldiers: Soldier[] = [];
  player: Soldier;
  enemies: Soldier[] = [];
  flyers: FlyingEnemy[] = [];
  playerFlyers: Flyer[] = [];
  units: Unit[] = [];
  projectiles: Ballistic[] = [];

  status: "playing" | "win" | "lose" = "playing";
  endDelay = 0;
  time = 0;
  respawnTimer = 0; // 测试关:敌人全灭后的重生倒计时

  get isTest(): boolean {
    return this.game.session?.isTest === true;
  }

  get waterY(): number {
    return this.terrain.waterY;
  }

  constructor(
    public game: Game,
    public session: GameSession,
    public level: Level
  ) {
    // 地形
    this.terrain.build(level.terrain.platforms);
    this.terrain.waterY = level.terrain.waterY;
    if (level.terrain.bridge) this.bridge = new Bridge(level.terrain.bridge);

    // 玩家
    this.player = new Soldier(this, "player", true, level.playerStart[0], level.playerStart[1], 100);
    this.player.weaponIdx = session.currentWeapon;
    this.player.weaponLevel = session.weaponLevel(session.currentWeapon);
    this.soldiers.push(this.player);

    // 地面敌人
    for (const cfg of level.enemies.ground) {
      const e = new Soldier(this, "enemy", false, cfg.x, level.playerStart[1], cfg.hp);
      e.weaponIdx = 0;
      const ai = new Ai(this, e, cfg);
      (e as any).ai = ai;
      this.enemies.push(e);
      this.soldiers.push(e);
    }

    // 飞行敌人
    for (const cfg of level.enemies.fly) {
      const startX = (cfg.patrol[0] + cfg.patrol[1]) / 2;
      const f = new FlyingEnemy(this, cfg, startX);
      f.weapon = this.makeFallWeapon(cfg.bombPower);
      this.flyers.push(f);
    }
  }

  makeFallWeapon(power: number): WeaponDef {
    return { ...WEAPONS[15], power: [power, power, power], radius: [42, 42, 42] };
  }

  fallWeapon(): WeaponDef {
    return this.flyers[0]?.weapon ?? WEAPONS[15];
  }

  /** 采样地面:地形表面 or 存活桥面,取从 fromY 向下最先遇到的 */
  sampleGround(x: number, fromY: number): number | null {
    const candidates: number[] = [];
    const surf = this.terrain.surfaceY(x, Math.max(0, fromY));
    if (surf !== null) candidates.push(surf);
    if (this.bridge) {
      const deck = this.bridge.deckYAt(x);
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
      this.addMoney(250, s.x, s.y - 60);
      this.fx.text(s.x, s.y - 80, "K.O.!", "#ffcc00", 22);
      const remain = this.enemies.filter((e) => e.alive).length + this.flyers.filter((f) => f.alive).length;
      if (remain === 0 && this.status === "playing") {
        if (this.isTest) {
          this.respawnTimer = 120; // 测试关:敌人重生,不结算过关
        } else {
          this.status = "win";
          this.endDelay = 80;
        }
      }
    } else {
      if (this.status === "playing") {
        this.status = "lose";
        this.endDelay = 90;
      }
    }
  }

  onFlyKill(_f: FlyingEnemy): void {
    this.addMoney(250, _f.x, _f.y - 30);
    this.fx.text(_f.x, _f.y - 46, "击落!", "#ffcc00", 20);
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

  /** 测试关:按关卡配置重新刷一波敌人 */
  respawnEnemies(): void {
    for (const cfg of this.level.enemies.ground) {
      const e = new Soldier(this, "enemy", false, cfg.x, this.level.playerStart[1], cfg.hp);
      e.weaponIdx = 0;
      const ai = new Ai(this, e, cfg);
      (e as any).ai = ai;
      this.enemies.push(e);
      this.soldiers.push(e);
    }
    for (const cfg of this.level.enemies.fly) {
      const startX = (cfg.patrol[0] + cfg.patrol[1]) / 2;
      const f = new FlyingEnemy(this, cfg, startX);
      f.weapon = this.makeFallWeapon(cfg.bombPower);
      this.flyers.push(f);
    }
    this.fx.text(400, 120, "敌人增援抵达!", "#ffcc00", 18);
  }

  explodeAt(x: number, y: number, opts: ExplodeOpts): void {
    explodeAt(this, x, y, opts);
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

    // 玩家
    const p = this.player;
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
    // 屏震偏移
    const sh = this.fx.shake;
    const sx = sh > 0 ? (Math.random() * 2 - 1) * sh : 0;
    const sy = sh > 0 ? (Math.random() * 2 - 1) * sh : 0;

    ctxT.clearRect(0, 0, 800, 600);
    ctxE.clearRect(0, 0, 800, 600);
    ctxF.clearRect(0, 0, 800, 600);

    ctxT.save();
    ctxT.translate(sx, sy);
    this.terrain.drawLayer(ctxT, this.time);
    if (this.bridge) this.bridge.draw(ctxT);
    this.fxGround.render(ctxT);
    ctxT.restore();

    ctxE.save();
    ctxE.translate(sx, sy);
    for (const u of this.units) u.render(ctxE);
    for (const pr of this.projectiles) pr.render(ctxE);
    for (const f of this.flyers) f.render(ctxE);
    for (const f of this.playerFlyers) f.render(ctxE);
    for (const s of this.soldiers) s.render(ctxE);
    ctxE.restore();

    ctxF.save();
    ctxF.translate(sx, sy);
    this.fx.render(ctxF);
    ctxF.restore();

    // 力度指示器(不随屏震)
    drawAimPreview(ctxF, this);
  }
}
