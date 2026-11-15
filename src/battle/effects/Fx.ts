// 特效管理器:序列帧 / 飘字 / 屏震 / 粒子
import { Assets, type FrameSeq } from "../../core/Assets";

interface SpriteFx {
  seq: FrameSeq;
  x: number;
  y: number;
  scale: number;
  frame: number; // 浮点推进
  alpha: number;
  additive: boolean;
  rotation?: number;
  dead?: boolean;
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  size: number;
}

interface IceSpike {
  x: number;
  y: number; // 地面基点
  h: number;
  w: number;
  life: number;
  maxLife: number;
}

interface Tracer {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
  maxLife: number;
  color: string;
}

export class Fx {
  sprites: SpriteFx[] = [];
  floats: FloatText[] = [];
  iceSpikes: IceSpike[] = [];
  tracers: Tracer[] = [];
  shake = 0; // 当前震幅
  private shakeDecay = 0.82;

  /** 播放一段序列帧 */
  sprite(seqName: string, x: number, y: number, scale = 1, additive = false, fpsMul = 1): void {
    const seq = Assets.seq(seqName);
    if (!seq) return;
    this.sprites.push({ seq, x, y, scale, frame: 0, alpha: 1, additive, dead: false });
  }

  /** 细线子弹轨迹(枪械射击用,约 0.15s 淡出) */
  addTracer(x1: number, y1: number, x2: number, y2: number, color = "#ffe9a8"): void {
    this.tracers.push({ x1, y1, x2, y2, life: 9, maxLife: 9, color });
  }

  /** 沿地形生成一根冰刺(冰爆专用) */
  addIceSpike(x: number, baseY: number, h: number): void {
    this.iceSpikes.push({
      x,
      y: baseY,
      h,
      w: 3 + Math.random() * 2.5,
      life: 110,
      maxLife: 110,
    });
  }

  /** 爆炸组合(火球+热烟) */
  explosion(x: number, y: number, scale = 1): void {
    this.sprite("fire", x, y, scale, true);
    this.sprite("smokeHot", x, y - scale * 8, scale * 0.95, false);
    this.shake = Math.min(10, this.shake + 4 * scale);
  }

  /** 灰白烟(死亡/落水) */
  smoke(x: number, y: number, scale = 1): void {
    this.sprite("smokeGray", x, y, scale, false);
  }

  flash(x: number, y: number, scale = 1): void {
    this.sprite("flash", x, y, scale, true);
  }

  puff(x: number, y: number, scale = 0.6): void {
    this.sprite("puff", x, y, scale, false);
  }

  text(x: number, y: number, text: string, color = "#ffd040", size = 18): void {
    this.floats.push({ x, y, text, color, life: 50, maxLife: 50, size });
  }

  addShake(v: number): void {
    this.shake = Math.min(12, this.shake + v);
  }

  step(): void {
    for (const s of this.sprites) {
      s.frame += s.seq.fps;
      if (s.frame >= s.seq.frames.length) s.dead = true;
    }
    this.sprites = this.sprites.filter((s) => !s.dead);
    for (const f of this.floats) {
      f.y -= 0.7;
      f.life--;
    }
    this.floats = this.floats.filter((f) => f.life > 0);
    for (const sp of this.iceSpikes) sp.life--;
    this.iceSpikes = this.iceSpikes.filter((sp) => sp.life > 0);
    for (const t of this.tracers) t.life--;
    this.tracers = this.tracers.filter((t) => t.life > 0);
    this.shake *= this.shakeDecay;
    if (this.shake < 0.3) this.shake = 0;
  }

  render(ctx: CanvasRenderingContext2D): void {
    for (const s of this.sprites) {
      const img = s.seq.frames[Math.min(s.seq.frames.length - 1, Math.floor(s.frame))];
      if (!img) continue;
      const w = img.width * s.scale;
      const h = img.height * s.scale;
      ctx.save();
      if (s.additive) ctx.globalCompositeOperation = "lighter";
      if (s.alpha < 1) ctx.globalAlpha = s.alpha;
      ctx.drawImage(img, s.x - w / 2, s.y - h / 2, w, h);
      ctx.restore();
    }
    // 冰刺(冰爆沿地形)
    for (const sp of this.iceSpikes) {
      const age = sp.maxLife - sp.life;
      const grow = Math.min(1, age / 8); // 前 8 帧长出
      const fade = Math.min(1, sp.life / 20); // 末 20 帧消融
      const h = sp.h * grow * (0.4 + 0.6 * fade);
      const w = sp.w * (0.5 + 0.5 * fade);
      if (h < 1) continue;
      ctx.fillStyle = "rgba(216, 242, 255, 0.92)";
      ctx.strokeStyle = "#5cb8e8";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sp.x - w, sp.y);
      ctx.lineTo(sp.x, sp.y - h);
      ctx.lineTo(sp.x + w, sp.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    // 细线子弹轨迹
    for (const t of this.tracers) {
      ctx.save();
      ctx.globalAlpha = (t.life / t.maxLife) * 0.9;
      ctx.strokeStyle = t.color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(t.x1, t.y1);
      ctx.lineTo(t.x2, t.y2);
      ctx.stroke();
      ctx.restore();
    }
    // 飘字
    ctx.textAlign = "center";
    for (const f of this.floats) {
      const a = Math.min(1, f.life / 15);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = `${f.size}px "Patrick Hand", "Segoe Print", cursive`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#1a1208";
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    }
  }
}
