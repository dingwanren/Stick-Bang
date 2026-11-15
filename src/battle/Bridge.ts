// 可破坏木桥:按 40px 分段,每段有 HP,打空即塌(相邻段连锁松动可选)

export interface BridgeDef {
  x: number;
  y: number; // 桥面(可站立)
  w: number;
  segHp: number;
}

const SEG_W = 40;
const WOOD = "#a88848";
const WOOD_DARK = "#7c6434";
const EDGE = "#1a1208";

export class BridgeSegment {
  alive = true;
  hp: number;
  constructor(public x: number, public y: number, public hpMax: number) {
    this.hp = hpMax;
  }
}

export class Bridge {
  segments: BridgeSegment[] = [];

  constructor(public def: BridgeDef) {
    const n = Math.round(def.w / SEG_W);
    for (let i = 0; i < n; i++) {
      this.segments.push(new BridgeSegment(def.x + i * SEG_W, def.y, def.segHp));
    }
  }

  /** 桥面碰撞:返回该 x 处的桥面 y(段存活),否则 null */
  deckYAt(x: number): number | null {
    for (const s of this.segments) {
      if (s.alive && x >= s.x && x < s.x + SEG_W) return s.y;
    }
    return null;
  }

  /** 对某点爆炸伤害(半径内所有段受伤) */
  applyDamage(cx: number, cy: number, radius: number, dmg: number): boolean {
    let anyBroken = false;
    for (const s of this.segments) {
      if (!s.alive) continue;
      const dx = s.x + SEG_W / 2 - cx;
      const dy = s.y + 4 - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < radius + 20) {
        s.hp -= dmg * (1 - Math.min(1, dist / (radius + 20)));
        if (s.hp <= 0) {
          s.alive = false;
          anyBroken = true;
        }
      }
    }
    return anyBroken;
  }

  /** 某点的桥面像素碰撞(弹丸撞桥) */
  solidAt(x: number, y: number): boolean {
    const deck = this.deckYAt(x);
    return deck !== null && y >= deck && y < deck + 7;
  }

  /** 工兵修复:全部段复原(无尽模式每 5 波章节调用) */
  repair(): void {
    for (const s of this.segments) {
      s.alive = true;
      s.hp = this.def.segHp;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const s of this.segments) {
      if (!s.alive) continue;
      // 桥面
      ctx.fillStyle = WOOD;
      ctx.fillRect(s.x, s.y, SEG_W, 7);
      // 木纹
      ctx.strokeStyle = WOOD_DARK;
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(s.x + 6 + i * 12, s.y + 1);
        ctx.lineTo(s.x + 6 + i * 12, s.y + 6);
        ctx.stroke();
      }
      // 描边
      ctx.strokeStyle = EDGE;
      ctx.strokeRect(s.x + 0.5, s.y + 0.5, SEG_W - 1, 6);
      // 受损显示:裂纹
      if (s.hp < s.hpMax * 0.6) {
        ctx.strokeStyle = EDGE;
        ctx.beginPath();
        ctx.moveTo(s.x + 10, s.y);
        ctx.lineTo(s.x + 16, s.y + 7);
        ctx.lineTo(s.x + 22, s.y + 1);
        ctx.stroke();
      }
      // 桥墩(画到下方,给桥悬浮感;段塌则墩保留)
    }
    // 桥墩:在段的间隙画支柱(只要两端存在即画,简单画两侧)
    const alive = this.segments.filter((s) => s.alive);
    if (alive.length > 0) {
      const first = alive[0];
      const last = alive[alive.length - 1];
      ctx.fillStyle = WOOD_DARK;
      ctx.fillRect(first.x + 2, first.y + 7, 6, 26);
      ctx.fillRect(last.x + SEG_W - 8, last.y + 7, 6, 26);
    }
  }
}
