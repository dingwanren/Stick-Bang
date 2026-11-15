// 地面效果:燃烧弹的沿地形火焰(中心点燃→向两侧扩散→烧完即散,不残留)与冰面(打滑)

import type { Terrain } from "../Terrain";
import type { Team } from "../Soldier";

export interface BurnPoint {
  x: number;
  y: number; // 地面表面点
}

export interface BurnZone {
  cx: number;
  cy: number;
  r: number; // 扩散目标半径
  points: BurnPoint[];
  life: number; // 剩余帧(总时长 ≈ 170 帧 ≈ 2.8s)
  tick: number;
  team: Team;
}

export interface IceZone {
  x: number;
  y: number;
  r: number;
  life: number;
}

export class GroundFx {
  burns: BurnZone[] = [];
  ices: IceZone[] = [];

  /** 燃烧弹落点:中心先点燃,step 中向两侧逐步扩散到 r */
  addBurn(cx: number, cy: number, r: number, terrain: Terrain, team: Team): void {
    const pts: BurnPoint[] = [];
    const sy = terrain.surfaceY(cx, cy - 20);
    if (sy !== null && sy < cy + 24) pts.push({ x: cx, y: sy });
    this.burns.push({ cx, cy, r, points: pts, life: 170, tick: 0, team });
  }

  addIce(x: number, y: number, r: number): void {
    this.ices.push({ x, y, r, life: 720 });
  }

  step(b: any): void {
    const terrain: Terrain = b.terrain;
    for (const z of this.burns) {
      z.life--;
      z.tick++;

      // 扩散阶段(前 96 帧):每 8 帧向左右各推进 14px,沿地形点燃新火点
      if (z.tick <= 96 && z.tick % 8 === 0) {
        const spread = Math.min(z.r, (z.tick / 8) * 14);
        for (const dir of [-1, 1]) {
          const x = z.cx + dir * spread;
          if (z.points.some((pt) => Math.abs(pt.x - x) < 8)) continue;
          const sy = terrain.surfaceY(x, z.cy - 20);
          if (sy !== null && sy < z.cy + 24) z.points.push({ x, y: sy });
        }
      }

      // 沿地形持续冒火(原版余烬帧,小尺寸、交错生成)
      if (z.tick % 10 === 0) {
        const offset = (z.tick / 10) % 2;
        for (let i = offset; i < z.points.length; i += 2) {
          const pt = z.points[i];
          b.fx.sprite("ember", pt.x, pt.y - 6, 0.26 + Math.random() * 0.14, true);
        }
      }

      // 每 25 帧对火点上的敌方单位造成伤害(攻击单位不伤己方)
      if (z.tick % 25 === 0) {
        for (const pt of z.points) {
          for (const s of b.soldiers) {
            if (!s.alive || s.team === z.team) continue;
            if (Math.abs(s.x - pt.x) < 12 && s.y > pt.y - 34 && s.y < pt.y + 10) {
              b.damageSoldier(s, 5, false, false, z.team);
            }
          }
          for (const u of b.units) {
            if (!u.alive || u.team === z.team) continue;
            if (Math.abs(u.x - pt.x) < 12 && u.y > pt.y - 30 && u.y < pt.y + 8) {
              u.hit(5);
            }
          }
        }
      }
    }
    this.burns = this.burns.filter((z) => z.life > 0); // 烧完即散,无残留

    for (const z of this.ices) z.life--;
    this.ices = this.ices.filter((z) => z.life > 0);
  }

  /** 某点是否在冰上(打滑判定) */
  onIce(x: number, y: number): boolean {
    for (const z of this.ices) {
      if (Math.abs(x - z.x) < z.r && Math.abs(y - z.y) < 30) return true;
    }
    return false;
  }

  render(ctx: CanvasRenderingContext2D): void {
    // 冰面反光
    for (const z of this.ices) {
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = "#bfeaff";
      ctx.beginPath();
      ctx.ellipse(z.x, z.y, z.r, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // 火点基光(微弱,配合余烬帧)
    for (const z of this.burns) {
      for (const pt of z.points) {
        ctx.save();
        ctx.globalAlpha = 0.16 + Math.sin(z.tick * 0.3 + pt.x) * 0.06;
        ctx.fillStyle = "#ff8828";
        ctx.beginPath();
        ctx.ellipse(pt.x, pt.y - 3, 7, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }
}
