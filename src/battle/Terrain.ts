// 地形:离屏位图(土+草) + Uint8Array 遮罩碰撞 + 破坏接口
// 与原版 BitmapData 方案等价:碰撞读遮罩,挖洞同步改遮罩+画布

export interface Platform {
  x: number;
  y: number; // 顶面
  w: number;
  h: number;
}

const W = 800;
const H = 600;

// 原版色板
const DIRT_DARK = "#685828";
const DIRT_MID = "#785828";
const DIRT_LIGHT = "#987858";
const GRASS_L = "#68a808";
const GRASS_D = "#589808";
const EDGE = "#1a1208";
const WATER = "#78c8f8";

export class Terrain {
  readonly width = W;
  readonly height = H;
  waterY = 555;

  earth: HTMLCanvasElement; // 只有土/草像素(透明=空)
  private earthCtx: CanvasRenderingContext2D;
  private mask: Uint8Array; // 1=实心
  platforms: Platform[] = [];

  constructor() {
    this.earth = document.createElement("canvas");
    this.earth.width = W;
    this.earth.height = H;
    this.earthCtx = this.earth.getContext("2d", { willReadFrequently: true })!;
    this.mask = new Uint8Array(W * H);
  }

  build(platforms: Platform[] | [number, number, number, number][]): void {
    this.platforms = platforms.map((p) =>
      Array.isArray(p) ? { x: p[0], y: p[1], w: p[2], h: p[3] } : p
    );
    this.earthCtx.clearRect(0, 0, W, H);
    this.mask.fill(0);
    for (const p of this.platforms) this.drawPlatform(p);
  }

  private drawPlatform(p: Platform): void {
    const c = this.earthCtx;
    // 土体:竖向亮暗条纹(对照原版剖面画法)
    const grad = c.createLinearGradient(p.x, p.y, p.x, p.y + p.h);
    grad.addColorStop(0, DIRT_LIGHT);
    grad.addColorStop(0.35, DIRT_MID);
    grad.addColorStop(1, DIRT_DARK);
    c.fillStyle = grad;
    c.fillRect(p.x, p.y, p.w, p.h);

    // 竖向条纹
    c.save();
    c.beginPath();
    c.rect(p.x, p.y, p.w, p.h);
    c.clip();
    const stripeW = 14;
    for (let sx = p.x - (p.y % stripeW); sx < p.x + p.w; sx += stripeW * 2) {
      c.fillStyle = "rgba(104, 88, 40, 0.35)";
      c.fillRect(sx, p.y + 10, stripeW, p.h);
    }
    // 少量石块点缀
    c.fillStyle = "rgba(152, 120, 88, 0.5)";
    for (let i = 0; i < p.w / 55; i++) {
      const rx = p.x + 12 + ((i * 37 + p.x) % (p.w - 24));
      const ry = p.y + 20 + ((i * 53 + p.y) % Math.max(1, p.h - 30));
      c.beginPath();
      c.ellipse(rx, ry, 5 + (i % 3) * 2, 3 + (i % 2) * 2, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();

    // 草皮帽
    c.fillStyle = GRASS_D;
    c.fillRect(p.x, p.y, p.w, 9);
    c.fillStyle = GRASS_L;
    c.fillRect(p.x, p.y, p.w, 5);
    // 草皮锯齿边缘
    c.fillStyle = GRASS_D;
    for (let gx = p.x; gx < p.x + p.w; gx += 7) {
      const gh = 3 + ((gx / 7) % 3) * 2;
      c.fillRect(gx, p.y + 9, 4, gh);
    }

    // 描边
    c.strokeStyle = EDGE;
    c.lineWidth = 2;
    c.strokeRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);

    // 写入遮罩
    const x0 = Math.max(0, Math.floor(p.x));
    const y0 = Math.max(0, Math.floor(p.y));
    const x1 = Math.min(W, Math.ceil(p.x + p.w));
    const y1 = Math.min(H, Math.ceil(p.y + p.h));
    for (let yy = y0; yy < y1; yy++) {
      const row = yy * W;
      for (let xx = x0; xx < x1; xx++) this.mask[row + xx] = 1;
    }
  }

  solidAt(x: number, y: number): boolean {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= W || iy < 0 || iy >= H) return false;
    return this.mask[iy * W + ix] === 1;
  }

  /** 从 fromY 向上找地表(返回可站立 y,找不到返回 null) */
  surfaceY(x: number, fromY: number): number | null {
    const ix = Math.floor(x);
    if (ix < 0 || ix >= W) return null;
    const start = Math.max(0, Math.floor(fromY));
    for (let iy = start; iy < H; iy++) {
      if (this.mask[iy * W + ix] === 1) return iy;
    }
    return null;
  }

  /** 爆炸挖洞 */
  carve(cx: number, cy: number, r: number): void {
    const c = this.earthCtx;
    c.save();
    c.globalCompositeOperation = "destination-out";
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fill();
    c.restore();
    const x0 = Math.max(0, Math.floor(cx - r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const x1 = Math.min(W - 1, Math.ceil(cx + r));
    const y1 = Math.min(H - 1, Math.ceil(cy + r));
    const r2 = r * r;
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const dx = xx - cx;
        const dy = yy - cy;
        if (dx * dx + dy * dy <= r2) this.mask[yy * W + xx] = 0;
      }
    }
  }

  /** 燃烧焦痕(只改视觉,不改碰撞) */
  scorch(cx: number, cy: number, r: number): void {
    const c = this.earthCtx;
    c.save();
    c.globalCompositeOperation = "source-atop"; // 只画在土上
    c.fillStyle = "rgba(20, 12, 4, 0.55)";
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  /** 铺冰视觉(画在土上,半透明白) */
  paintIce(cx: number, cy: number, r: number): void {
    const c = this.earthCtx;
    c.save();
    c.globalCompositeOperation = "source-atop";
    c.fillStyle = "rgba(210, 240, 255, 0.75)";
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "rgba(255,255,255,0.9)";
    c.lineWidth = 2;
    c.beginPath();
    c.arc(cx, cy, r - 1, 0, Math.PI * 2);
    c.stroke();
    c.restore();
  }

  /** 静态背景层绘制(每帧由 Battle 调用):天空/云/土/水 */
  drawLayer(ctx: CanvasRenderingContext2D, time: number): void {
    // 天空
    const sky = ctx.createLinearGradient(0, 0, 0, this.height);
    sky.addColorStop(0, "#1878f8");
    sky.addColorStop(1, "#58a8f8");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // 云(缓慢漂移)
    this.drawClouds(ctx, time);

    // 土
    ctx.drawImage(this.earth, 0, 0);

    // 水
    this.drawWater(ctx, time);
  }

  private drawClouds(ctx: CanvasRenderingContext2D, time: number): void {
    ctx.save();
    ctx.fillStyle = "#ffffff";
    const clouds = [
      [80, 70, 46, 1.0],
      [260, 120, 60, 0.8],
      [500, 60, 52, 1.1],
      [700, 130, 44, 0.9],
      [620, 40, 38, 0.7],
      [150, 180, 40, 0.6],
    ];
    for (const [cx, cy, r, sp] of clouds) {
      const x = ((cx + time * 0.12 * sp) % (W + 160)) - 80;
      this.cloudBlob(ctx, x, cy, r);
    }
    ctx.restore();
  }

  private cloudBlob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.arc(x + r * 0.8, y - r * 0.35, r * 0.75, 0, Math.PI * 2);
    ctx.arc(x + r * 1.7, y + r * 0.1, r * 0.65, 0, Math.PI * 2);
    ctx.arc(x - r * 0.8, y + r * 0.15, r * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawWater(ctx: CanvasRenderingContext2D, time: number): void {
    const y = this.waterY;
    ctx.fillStyle = WATER;
    ctx.fillRect(0, y, W, H - y);
    // 波浪
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 8) {
      const wy = y + Math.sin(x * 0.05 + time * 0.04) * 2.5;
      if (x === 0) ctx.moveTo(x, wy);
      else ctx.lineTo(x, wy);
    }
    ctx.stroke();
    ctx.fillStyle = "rgba(120, 200, 248, 0.35)";
    ctx.fillRect(0, y, W, 14);
  }
}
