// 地形:离屏位图(基岩石块 + 表土草皮) + Uint8Array 遮罩碰撞 + 破坏接口
// 双层结构:基岩层永不破坏(carve 自动跳过),表土层可炸可挖;碰撞 = 基岩 ∪ 表土
// 支持斜坡平台(五元组 [x,y,w,h,y2]:顶面从左 y 斜到右 y2)——像素遮罩逐列采样天然支持行走贴合
// 宽高均可由关卡指定(剧情关 800×600,无尽 1600×800)

export interface Platform {
  x: number;
  y: number; // 顶面(斜坡=左端顶面)
  w: number;
  h: number;
  y2?: number; // 斜坡:右端顶面(未定义=矩形)
}

export type PlatformInput = Platform | [number, number, number, number] | [number, number, number, number, number];

const DIRT_DARK = "#685828";
const DIRT_MID = "#785828";
const DIRT_LIGHT = "#987858";
const GRASS_L = "#68a808";
const GRASS_D = "#589808";
// 基岩色板(灰岩,无草皮——一眼读出"挖不动")
const ROCK_L = "#9c9c90";
const ROCK_M = "#808072";
const ROCK_D = "#5e5e52";
const EDGE = "#1a1208";
const WATER = "#78c8f8";

export class Terrain {
  readonly width: number;
  readonly height: number;
  waterY = 555;

  earth: HTMLCanvasElement; // 表土像素(透明=空)
  private earthCtx: CanvasRenderingContext2D;
  private bedrockCv: HTMLCanvasElement; // 基岩像素(永不破坏)
  private bedrockCtx: CanvasRenderingContext2D;
  private mask: Uint8Array; // 组合碰撞(基岩∪表土) 1=实心
  private soilMask: Uint8Array; // 仅表土(carve 只清除这里为 1 的像素)
  platforms: Platform[] = [];
  private bedrockPlats: Platform[] = [];

  constructor(width = 800, height = 600) {
    this.width = width;
    this.height = height;
    this.earth = document.createElement("canvas");
    this.earth.width = width;
    this.earth.height = height;
    this.earthCtx = this.earth.getContext("2d", { willReadFrequently: true })!;
    this.bedrockCv = document.createElement("canvas");
    this.bedrockCv.width = width;
    this.bedrockCv.height = height;
    this.bedrockCtx = this.bedrockCv.getContext("2d")!;
    this.mask = new Uint8Array(width * height);
    this.soilMask = new Uint8Array(width * height);
  }

  build(platforms: PlatformInput[], bedrock: PlatformInput[] = []): void {
    const norm = (p: PlatformInput): Platform =>
      Array.isArray(p)
        ? { x: p[0], y: p[1], w: p[2], h: p[3], y2: p.length >= 5 ? p[4] : undefined }
        : p;
    this.platforms = platforms.map(norm);
    this.bedrockPlats = bedrock.map(norm);
    this.earthCtx.clearRect(0, 0, this.width, this.height);
    this.bedrockCtx.clearRect(0, 0, this.width, this.height);
    this.mask.fill(0);
    this.soilMask.fill(0);
    for (const p of this.bedrockPlats) this.drawBedrockPlatform(p);
    for (const p of this.platforms) this.drawPlatform(p);
  }

  /** 工兵整地:表土层复原(基岩本就未被破坏,焦痕一并清除) */
  repairSoil(): void {
    this.build(this.platforms, this.bedrockPlats);
  }

  private drawPlatform(p: Platform): void {
    if (p.y2 !== undefined && p.y2 !== p.y) this.drawSlopePlatform(p);
    else this.drawRectPlatform(p);
    this.writeMask(p, true);
  }

  private drawRectPlatform(p: Platform): void {
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
  }

  /** 斜坡:顶面从左 y 斜到右 y2,土体到底部;草皮沿斜边描带 */
  private drawSlopePlatform(p: Platform): void {
    const c = this.earthCtx;
    const bot = Math.max(p.y, p.y2!) + p.h;
    const topMin = Math.min(p.y, p.y2!);

    c.save();
    c.beginPath();
    c.moveTo(p.x, p.y);
    c.lineTo(p.x + p.w, p.y2!);
    c.lineTo(p.x + p.w, bot);
    c.lineTo(p.x, bot);
    c.closePath();

    // 土体渐变
    const grad = c.createLinearGradient(0, topMin, 0, bot);
    grad.addColorStop(0, DIRT_LIGHT);
    grad.addColorStop(0.35, DIRT_MID);
    grad.addColorStop(1, DIRT_DARK);
    c.fillStyle = grad;
    c.fill();

    // 竖向条纹 + 石块(clip 在坡体内)
    c.clip();
    const stripeW = 14;
    for (let sx = p.x - (topMin % stripeW); sx < p.x + p.w; sx += stripeW * 2) {
      c.fillStyle = "rgba(104, 88, 40, 0.35)";
      c.fillRect(sx, topMin + 10, stripeW, bot - topMin);
    }
    c.fillStyle = "rgba(152, 120, 88, 0.5)";
    for (let i = 0; i < p.w / 55; i++) {
      const rx = p.x + 12 + ((i * 37 + p.x) % Math.max(1, p.w - 24));
      const ry = topMin + 25 + ((i * 53 + p.x) % Math.max(1, bot - topMin - 30));
      c.beginPath();
      c.ellipse(rx, ry, 5 + (i % 3) * 2, 3 + (i % 2) * 2, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();

    // 草皮沿斜边(暗底带 + 亮面带)
    c.save();
    c.lineCap = "butt";
    c.strokeStyle = GRASS_D;
    c.lineWidth = 9;
    c.beginPath();
    c.moveTo(p.x, p.y + 3);
    c.lineTo(p.x + p.w, p.y2! + 3);
    c.stroke();
    c.strokeStyle = GRASS_L;
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(p.x, p.y);
    c.lineTo(p.x + p.w, p.y2!);
    c.stroke();
    // 草皮锯齿(沿斜线每隔 7px 画小草块)
    c.fillStyle = GRASS_D;
    for (let gx = p.x; gx < p.x + p.w; gx += 7) {
      const t = (gx - p.x) / p.w;
      const gy = p.y + (p.y2! - p.y) * t;
      const gh = 3 + ((gx / 7) % 3) * 2;
      c.fillRect(gx, gy + 9, 4, gh);
    }
    c.restore();

    // 描边
    c.strokeStyle = EDGE;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(p.x + 1, p.y + 1);
    c.lineTo(p.x + p.w - 1, p.y2! + 1);
    c.lineTo(p.x + p.w - 1, bot - 1);
    c.lineTo(p.x + 1, bot - 1);
    c.closePath();
    c.stroke();
  }

  /** 基岩:灰色岩块 + 砖缝,无草皮(矩形;斜坡基岩不做) */
  private drawBedrockPlatform(p: Platform): void {
    const c = this.bedrockCtx;
    const y2 = p.y2 ?? p.y;
    const bot = Math.max(p.y, y2) + p.h;
    const topMin = Math.min(p.y, y2);
    const grad = c.createLinearGradient(0, topMin, 0, bot);
    grad.addColorStop(0, ROCK_L);
    grad.addColorStop(0.4, ROCK_M);
    grad.addColorStop(1, ROCK_D);
    c.fillStyle = grad;
    if (p.y2 !== undefined && p.y2 !== p.y) {
      c.beginPath();
      c.moveTo(p.x, p.y);
      c.lineTo(p.x + p.w, y2);
      c.lineTo(p.x + p.w, bot);
      c.lineTo(p.x, bot);
      c.closePath();
      c.fill();
    } else {
      c.fillRect(p.x, p.y, p.w, p.h);
    }

    // 砖缝(错缝砌法,矩形才画横缝)
    c.save();
    c.beginPath();
    c.moveTo(p.x, p.y);
    c.lineTo(p.x + p.w, y2);
    c.lineTo(p.x + p.w, bot);
    c.lineTo(p.x, bot);
    c.closePath();
    c.clip();
    c.strokeStyle = "rgba(26, 18, 8, 0.35)";
    c.lineWidth = 2;
    const rowH = 26;
    for (let ry = topMin + rowH; ry < bot; ry += rowH) {
      c.beginPath();
      c.moveTo(p.x, ry);
      c.lineTo(p.x + p.w, ry);
      c.stroke();
      const offset = ((ry / rowH) % 2) * 30;
      for (let rx = p.x + offset; rx < p.x + p.w; rx += 60) {
        c.beginPath();
        c.moveTo(rx, ry - rowH);
        c.lineTo(rx, ry);
        c.stroke();
      }
    }
    // 顶部高光条(替代草皮的"可站"提示)
    c.fillStyle = "rgba(255, 255, 255, 0.22)";
    if (p.y2 !== undefined && p.y2 !== p.y) {
      c.lineWidth = 4;
      c.strokeStyle = "rgba(255, 255, 255, 0.22)";
      c.beginPath();
      c.moveTo(p.x, p.y + 2);
      c.lineTo(p.x + p.w, y2 + 2);
      c.stroke();
    } else {
      c.fillRect(p.x, p.y, p.w, 4);
    }
    c.restore();

    // 描边
    c.strokeStyle = EDGE;
    c.lineWidth = 2;
    if (p.y2 !== undefined && p.y2 !== p.y) {
      c.beginPath();
      c.moveTo(p.x + 1, p.y + 1);
      c.lineTo(p.x + p.w - 1, y2 + 1);
      c.lineTo(p.x + p.w - 1, bot - 1);
      c.lineTo(p.x + 1, bot - 1);
      c.closePath();
      c.stroke();
    } else {
      c.strokeRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
    }

    this.writeMask(p, false);
  }

  /** 该列的顶面 y(斜坡插值;矩形=p.y) */
  private topAt(p: Platform, xx: number): number {
    if (p.y2 === undefined) return p.y;
    const t = Math.max(0, Math.min(1, (xx - p.x) / p.w));
    return p.y + (p.y2 - p.y) * t;
  }

  /** 写入遮罩;soil=true 同时写 soilMask(可挖) */
  private writeMask(p: Platform, soil: boolean): void {
    const W = this.width;
    const H = this.height;
    const x0 = Math.max(0, Math.floor(p.x));
    const x1 = Math.min(W, Math.ceil(p.x + p.w));
    const bot = Math.max(p.y, p.y2 ?? p.y) + p.h;
    const y1 = Math.min(H, Math.ceil(bot));
    for (let xx = x0; xx < x1; xx++) {
      const top = Math.max(0, Math.floor(this.topAt(p, xx)));
      const col = xx;
      for (let yy = top; yy < y1; yy++) {
        this.mask[yy * W + col] = 1;
        if (soil) this.soilMask[yy * W + col] = 1;
      }
    }
  }

  solidAt(x: number, y: number): boolean {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return false;
    return this.mask[iy * this.width + ix] === 1;
  }

  /** 从 fromY 向上找地表(返回可站立 y,找不到返回 null) */
  surfaceY(x: number, fromY: number): number | null {
    const ix = Math.floor(x);
    if (ix < 0 || ix >= this.width) return null;
    const start = Math.max(0, Math.floor(fromY));
    for (let iy = start; iy < this.height; iy++) {
      if (this.mask[iy * this.width + ix] === 1) return iy;
    }
    return null;
  }

  /** 爆炸挖洞:只破坏表土(基岩仅留焦痕,碰撞不变) */
  carve(cx: number, cy: number, r: number): void {
    const c = this.earthCtx;
    c.save();
    c.globalCompositeOperation = "destination-out";
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fill();
    c.restore();
    const W = this.width;
    const x0 = Math.max(0, Math.floor(cx - r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const x1 = Math.min(W - 1, Math.ceil(cx + r));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + r));
    const r2 = r * r;
    for (let yy = y0; yy <= y1; yy++) {
      const row = yy * W;
      for (let xx = x0; xx <= x1; xx++) {
        const dx = xx - cx;
        const dy = yy - cy;
        if (dx * dx + dy * dy <= r2 && this.soilMask[row + xx] === 1) {
          this.mask[row + xx] = 0;
          this.soilMask[row + xx] = 0;
        }
      }
    }
  }

  /** 燃烧焦痕(只改视觉,不改碰撞;表土与基岩都留痕) */
  scorch(cx: number, cy: number, r: number): void {
    for (const c of [this.earthCtx, this.bedrockCtx]) {
      c.save();
      c.globalCompositeOperation = "source-atop"; // 只画在各自像素上
      c.fillStyle = "rgba(20, 12, 4, 0.55)";
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
  }

  /** 铺冰视觉(画在地表像素上,半透明白) */
  paintIce(cx: number, cy: number, r: number): void {
    for (const c of [this.earthCtx, this.bedrockCtx]) {
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
  }

  /** 静态背景层绘制(每帧由 Battle 调用):天空/云/基岩/表土/水 */
  drawLayer(ctx: CanvasRenderingContext2D, time: number): void {
    const W = this.width;
    const H = this.height;
    // 天空
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#1878f8");
    sky.addColorStop(1, "#58a8f8");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // 云(缓慢漂移)
    this.drawClouds(ctx, time);

    // 基岩在下层,表土覆盖其上
    ctx.drawImage(this.bedrockCv, 0, 0);
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
      [900, 90, 50, 1.0],
      [1150, 50, 42, 0.8],
      [1350, 140, 56, 0.9],
      [1450, 260, 40, 0.7],
      [350, 260, 44, 0.8],
    ];
    for (const [cx, cy, r, sp] of clouds) {
      const x = ((cx + time * 0.12 * sp) % (this.width + 160)) - 80;
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
    const W = this.width;
    const H = this.height;
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
