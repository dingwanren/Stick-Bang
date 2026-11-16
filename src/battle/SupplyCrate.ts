// 补给箱:每清一波空投(带降落伞缓降)→ 落地待拾取
// 拾取 = 回 25HP + 当前手持武器补满;被爆炸波及即摧毁;落水作废(无尽模式专用)

import type { Battle } from "./Battle";
import { WEAPONS } from "../data/weapons";
import { Audio } from "../core/Audio";
import { drawChute } from "./projectiles/GroundUnit";

export class SupplyCrate {
  dead = false;
  landed = false;
  private vy = 0;
  private sway = Math.random() * Math.PI * 2;

  constructor(
    public b: Battle,
    public x: number,
    public y = -30
  ) {}

  step(): void {
    if (this.landed || this.dead) return;
    this.sway += 0.05;
    this.vy = Math.min(this.vy + 0.06, 1.3);
    this.y += this.vy;
    this.x += Math.sin(this.sway) * 0.3;

    // 落地:采样地面(含桥面)
    const g = this.b.sampleGround(this.x, Math.max(0, this.y - 4));
    if (g !== null && this.y >= g - 2) {
      this.y = g;
      this.landed = true;
      this.vy = 0;
      this.b.fx.puff(this.x, this.y - 6, 0.6);
      Audio.play("hit", { vol: 0.4, rate: 0.9 });
      return;
    }
    // 落水作废
    if (this.y > this.b.waterY) {
      this.b.fx.smoke(this.x, this.b.waterY - 6, 0.9);
      this.b.fx.text(this.x, this.b.waterY - 30, "补给落水!", "#8fd8ff", 14);
      this.dead = true;
    }
  }

  /** 玩家拾取:回血 + 随机 3 种持有武器各补满(不再只补当前手持) */
  collect(): void {
    const b = this.b;
    const s = b.game.session;
    if (!s) return;
    b.player.heal(25);
    b.fx.text(this.x, this.y - 40, "+25", "#40c820", 18);
    // 池 = 开局发放过的商店武器(全部非 hidden);随机抽 3 种各补满
    const pool: number[] = [];
    for (let i = 1; i < WEAPONS.length - 1; i++) {
      if (!WEAPONS[i].hidden) pool.push(i);
    }
    const picks: number[] = [];
    while (picks.length < 3 && pool.length > 0) {
      picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    for (const i of picks) s.setAmmo(i, WEAPONS[i].carryMax);
    if (picks.length > 0) {
      b.fx.text(this.x, this.y - 62, picks.map((i) => WEAPONS[i].name).join("·") + " 补满!", "#ffd040", 14);
    }
    b.game.weaponBar.refresh();
    b.game.hud.refreshPreview();
    Audio.play("hit", { vol: 0.5, rate: 1.5 });
    this.dead = true;
  }

  /** 被爆炸波及:摧毁 */
  destroy(): void {
    const b = this.b;
    b.fx.explosion(this.x, this.y - 8, 0.7);
    b.fx.text(this.x, this.y - 40, "补给被炸毁!", "#ff6040", 16);
    Audio.play("explosion", { vol: 0.6, rate: 1.2 });
    this.dead = true;
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (this.dead) return;
    // 缓降时画降落伞
    if (!this.landed) drawChute(ctx, this.x, this.y - 6);
    // 木箱
    const bx = this.x - 9;
    const by = this.y - 15;
    ctx.fillStyle = "#a88848";
    ctx.fillRect(bx, by, 18, 15);
    ctx.fillStyle = "#7c6434";
    ctx.fillRect(bx, by + 6, 18, 3); // 捆带
    ctx.strokeStyle = "#1a1208";
    ctx.lineWidth = 2;
    ctx.strokeRect(bx + 0.5, by + 0.5, 17, 14);
    // 十字补给标
    ctx.fillStyle = "#ffd040";
    ctx.fillRect(this.x - 1.5, by + 2, 3, 8);
    ctx.fillRect(this.x - 4, by + 4.5, 8, 3);
  }
}
