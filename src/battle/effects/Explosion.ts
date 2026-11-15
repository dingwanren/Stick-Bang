// 爆炸:范围伤害判定 + 地形破坏 + 特效/音效
// 伤害模型:直击(命中弹丸)全额 power;溅射按距离衰减;友军波及用 hurt

import type { Battle } from "../Battle";
import type { Team } from "../Soldier";
import { Audio } from "../../core/Audio";

export interface ExplodeOpts {
  power: number; // 对敌伤害(爆心全额)
  hurt: number; // 对友方/自身伤害
  radius: number;
  team: Team; // 爆炸归属(结算敌我)
  scale?: number; // 视觉缩放
  sound?: "explosion" | "big_explosion" | "ice";
  freeze?: number; // 冻结帧数(0=无)
  burn?: boolean; // 生成沿地形火焰
  ice?: boolean; // 冰爆视觉(沿地形冰刺,不挖地形不炸桥)
  dig?: number; // 挖洞深度(0=普通爆炸)
  noCarve?: boolean;
}

export function explodeAt(b: Battle, x: number, y: number, opts: ExplodeOpts): void {
  const { power, hurt, radius, team } = opts;
  const scale = opts.scale ?? Math.min(1.25, Math.max(0.55, radius / 46));

  if (opts.ice) {
    // 冰爆:白色闪光 + 沿地形长出冰刺(无火焰、不挖地形、不炸桥)
    b.fx.flash(x, y - 8, scale * 0.55);
    const step = 11;
    for (let sx = x - radius; sx <= x + radius; sx += step) {
      const sy = b.terrain.surfaceY(sx, y - radius * 0.7);
      if (sy === null || sy > y + radius) continue;
      const taper = 1 - (Math.abs(sx - x) / (radius + 1)) * 0.55;
      const h = Math.max(5, (6 + Math.random() * 16) * taper);
      b.fx.addIceSpike(sx + (Math.random() * 4 - 2), sy, h);
    }
    b.fx.addShake(1.5);
  } else if (radius <= 0) {
    // 零半径(伞兵子弹等):只冒小尘土
    b.fx.puff(x, y, 0.55);
  } else {
    // 爆炸:火球+烟(白色尖刺光束只属于冰爆)
    b.fx.explosion(x, y, scale);
    b.fx.addShake(4 * scale);
  }
  Audio.play(opts.sound ?? "explosion", { vol: 0.9, rate: 0.9 + Math.random() * 0.25 });

  // 地形破坏
  if (opts.dig) {
    b.terrain.carve(x, y, Math.max(10, radius * 0.5));
    b.terrain.carve(x, y + opts.dig * 0.5, Math.max(8, radius * 0.42));
  } else if (!opts.noCarve && !opts.ice && radius > 0) {
    b.terrain.carve(x, y, radius * 0.82);
  }
  if (opts.burn) b.fxGround.addBurn(x, y, radius * 0.95, b.terrain, team);
  if (opts.freeze) {
    for (const s of b.soldiers) {
      if (dist(s.x, s.y - 18, x, y) < radius + 6 && s.team !== team) s.frozenFor = opts.freeze;
    }
  }

  // 桥
  if (b.bridge && radius > 0 && !opts.ice) {
    const broken = b.bridge.applyDamage(x, y, radius, Math.max(power, hurt, 12));
    if (broken) Audio.play("hit", { vol: 0.7, rate: 0.8 });
  }

  // 士兵伤害(溅射衰减)
  for (const s of b.soldiers) {
    if (!s.alive) continue;
    const d = dist(s.x, s.y - 18, x, y);
    if (d > radius + 17) continue;
    const friendly = s.team === team;
    const base = friendly ? hurt : power;
    if (base <= 0) continue;
    // 距离衰减:爆心全额,边缘 25%
    const falloff = d <= 17 ? 1 : Math.max(0.25, 1 - (d - 17) / radius);
    const dmg = Math.round(base * falloff);
    if (dmg <= 0) continue;
    const direct = d <= 20;
    b.damageSoldier(s, dmg, direct, false, team);
  }

  // 地面弹药单位(弹药小人):任何爆炸都会炸到——包括自己人扔的炸弹(原版逻辑)
  for (const u of b.units) {
    if (!u.alive) continue;
    const d = dist(u.x, u.y - 12, x, y);
    if (d > radius + 10) continue;
    u.hit(Math.round(power * 0.6) || 10);
  }

  // 飞行单位伤害
  for (const f of b.flyers) {
    if (!f.alive || f.team === team) continue;
    const d = dist(f.x, f.y, x, y);
    if (d > radius + 14) continue;
    const dmg = Math.round(power * Math.max(0.3, 1 - d / (radius + 14)));
    if (dmg > 0) f.hit(dmg, d <= 17, team);
  }
}

function dist(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}
