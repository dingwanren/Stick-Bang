// 飞行敌人(对应原版 game.Man_flight):天空中随机徘徊,锁定玩家俯冲投弹
// 被击落:原地一炸即消失(不坠机);轨迹为宽范围随机徘徊,升降均为平滑匀速

import type { Battle } from "./Battle";
import type { WeaponDef } from "../data/weapons";
import { Ballistic } from "./projectiles/Ballistic";
import { Audio } from "../core/Audio";
import { drawStickman } from "./figures";
import type { FlyEnemyCfg } from "../data/levels";

export class FlyingEnemy {
  alive = true;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  dir: 1 | -1 = 1;
  speed: number;
  reload: number;
  reloadMax: number;
  bob = Math.random() * Math.PI * 2;
  fallDone = true; // 死亡即结束(供 Battle 清理)
  team = "enemy" as const;
  weapon: WeaponDef = null as unknown as WeaponDef; // 由 Battle 注入(空投弹数值)

  // 徘徊目标(宽范围随机)
  private wx = 400;
  private wy = 110;
  private wanderT = 0;
  // 俯冲状态
  mode: "cruise" | "dive" | "climb" = "cruise";
  private dropY = 180;
  private dropTargetX = 0;
  private stateT = 0;

  patrolMin: number;
  patrolMax: number;
  bombPower: number;
  bombError: number;

  constructor(
    public b: Battle,
    cfg: FlyEnemyCfg,
    startX: number
  ) {
    this.hp = cfg.hp;
    this.maxHp = cfg.hp;
    this.x = startX;
    this.y = 90 + Math.random() * 40;
    this.patrolMin = cfg.patrol[0];
    this.patrolMax = cfg.patrol[1];
    this.speed = 1.1 + Math.random() * 0.9; // 1.1~2.0 px/帧
    this.bombPower = cfg.bombPower;
    this.bombError = cfg.bombError;
    this.reloadMax = cfg.reload;
    this.reload = cfg.reload * (0.4 + Math.random() * 0.4);
    this.dir = Math.random() < 0.5 ? 1 : -1;
    this.pickWander();
  }

  /** 选一个徘徊目标点:水平范围 = 巡逻带向两侧各扩 100,垂直随世界高度 */
  private pickWander(): void {
    const minX = Math.max(40, this.patrolMin - 100);
    const maxX = Math.min(this.b.terrain.width - 40, this.patrolMax + 100);
    this.wx = minX + Math.random() * (maxX - minX);
    this.wy = 60 + Math.random() * (this.b.terrain.height >= 800 ? 250 : 140);
    this.wanderT = 180 + Math.random() * 120; // 3~5 秒换目标
  }

  hit(dmg: number, direct = false, from: "player" | "enemy" = "player"): void {
    if (!this.alive) return;
    this.hp -= dmg;
    // 命中给钱(仅玩家侧来源,与地面敌人同公式)
    if (from === "player") {
      const money = direct ? 55 + Math.round(dmg * 0.8) : Math.round(dmg * 1.6);
      this.b.addMoney(money, this.x + (Math.random() - 0.5) * 10, this.y - 14);
    }
    this.b.fx.text(this.x + (Math.random() - 0.5) * 10, this.y - 14, `-${dmg}`, "#ffd040", 15);
    Audio.play("hit", { vol: 0.4, rate: 1.2 + Math.random() * 0.3 });
    if (this.hp <= 0) {
      // 天上被击毁:原地爆炸一次即消失
      this.alive = false;
      this.fallDone = true;
      this.b.fx.explosion(this.x, this.y, 0.9);
      Audio.play("explosion", { vol: 0.8 });
      this.b.onFlyKill(this);
    }
  }

  step(): void {
    const b = this.b;
    if (!this.alive) return;
    this.bob += 0.08;

    const p = b.player;

    if (this.mode === "cruise") {
      // 随机徘徊:平滑飞向目标点
      this.wanderT--;
      const dx = this.wx - this.x;
      const dy = this.wy - this.y;
      const d = Math.hypot(dx, dy) || 1;
      this.x += (dx / d) * this.speed;
      this.y += (dy / d) * this.speed * 0.8 + Math.sin(this.bob) * 0.25;
      this.x = Math.max(24, Math.min(this.b.terrain.width - 24, this.x));
      this.y = Math.max(40, Math.min(this.b.terrain.height >= 800 ? 320 : 230, this.y));
      if (d < 24 || this.wanderT <= 0) this.pickWander();
      // 装填完毕且有目标 → 进入俯冲
      this.reload--;
      if (p && p.alive && this.reload <= 0) {
        this.mode = "dive";
        this.stateT = 0;
        this.dropY = (this.b.terrain.height >= 800 ? 260 : 175) + Math.random() * 30;
        this.dropTargetX = p.x + Math.sign(p.vxEstimate()) * 52 + (Math.random() - 0.5) * 120 * this.bombError * 10;
      }
    } else if (this.mode === "dive") {
      // 横移对准锁定落点 + 平缓下降
      const dx = this.dropTargetX - this.x;
      if (Math.abs(dx) > 5) this.x += Math.sign(dx) * Math.min(this.speed * 2.0, Math.abs(dx));
      this.y = Math.min(this.y + 2.6, this.dropY);
      if (Math.abs(dx) <= 5 && this.y >= this.dropY - 1) {
        // 投弹!
        this.mode = "climb";
        this.stateT = 0;
        this.reload = this.reloadMax;
        Audio.play("shoot_b", { vol: 0.5, rate: 0.8 });
        b.projectiles.push(
          new Ballistic(
            { b, team: "enemy", weapon: this.weapon, level: 0 },
            this.x,
            this.y + 12,
            Math.PI / 2,
            2.5,
            1,
            "bomb",
            6
          )
        );
        b.fx.puff(this.x, this.y + 10, 0.4);
      }
      if (this.stateT++ > 300) {
        this.mode = "climb";
        this.reload = 110;
        this.stateT = 0;
      }
    } else {
      // 爬升回巡航高度:匀速平滑,不再瞬移
      this.y -= 1.3;
      this.x += this.dir * this.speed * 0.5;
      if (this.y <= 66) {
        this.mode = "cruise";
        this.pickWander();
      }
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.alive) return;
    // 旋翼飞行小人
    const propT = Math.floor(Date.now() / 40) % 2 === 0;
    ctx.strokeStyle = "#1a1208";
    ctx.lineWidth = 2;
    ctx.save();
    ctx.translate(this.x, this.y - 16);
    ctx.beginPath();
    if (propT) {
      ctx.moveTo(-16, 0);
      ctx.lineTo(16, 0);
    } else {
      ctx.moveTo(-10, -3);
      ctx.lineTo(10, 3);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 6);
    ctx.stroke();
    ctx.restore();
    // 机身(小人 + 背包)
    drawStickman(ctx, {
      x: this.x,
      y: this.y + 14,
      facing: this.dir,
      cap: true,
      equipment: "jet",
      walk: -1,
      scale: 0.8,
    });
    // 血条
    const ratio = Math.max(0, this.hp / this.maxHp);
    const color = ratio > 0.55 ? "#40c820" : ratio > 0.25 ? "#e8a808" : "#d82020";
    ctx.fillStyle = "#1a1208";
    ctx.fillRect(this.x - 17, this.y - 26, 34, 6);
    ctx.fillStyle = color;
    ctx.fillRect(this.x - 16, this.y - 25, 32 * ratio, 4);
  }
}
