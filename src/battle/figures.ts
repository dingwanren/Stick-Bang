// 火柴人绘制库:圆头 + 线身 + 四肢 + 装备
// 规范:描边深棕黑 #1a1208,线宽≈3px@800×600;玩家=金色尖刺头盔+白甲,敌人=白帽
// "弹药即小人":每种弹药 = 一个装备变体

import type { WeaponDef } from "../data/weapons";

export const STROKE = "#1a1208";
export const BODY_BLACK = "#181818";

export interface StickOpts {
  x: number;
  y: number; // 脚底
  facing: 1 | -1;
  aim?: number; // 炮管角度(弧度)
  cannon?: boolean;
  walk?: number; // -1=站立, 0..1 行走相位
  player?: boolean; // 玩家造型
  cap?: boolean; // 敌人造型(白帽)
  bodyTint?: string;
  equipment?: EquipKey;
  frozen?: boolean;
  scale?: number;
  armSwing?: number; // 持物手臂摆动
}

export type EquipKey =
  | "umbrella"
  | "repair"
  | "freeze"
  | "burn"
  | "ice"
  | "jet"
  | "dagger"
  | "push"
  | "rifle"
  | "bombs"
  | "timed"
  | "shovel"
  | "rocket"
  | "suicide"
  | "none";

const LINE = 3;

export function drawStickman(ctx: CanvasRenderingContext2D, o: StickOpts): void {
  const s = o.scale ?? 1;
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.scale(s, s);
  ctx.lineWidth = LINE;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = BODY_BLACK;

  const hipY = -13;
  const headY = -34;
  const headR = 5;
  const shoulderY = -25;

  // ---- 腿(行走摆动) ----
  let lFoot = [-5, 0];
  let rFoot = [5, 0];
  if (o.walk !== undefined && o.walk >= 0) {
    const ph = o.walk * Math.PI * 2;
    lFoot = [-4 + Math.sin(ph) * 5, -Math.max(0, Math.sin(ph)) * 4];
    rFoot = [4 + Math.sin(ph + Math.PI) * 5, -Math.max(0, Math.sin(ph + Math.PI)) * 4];
  } else if (o.walk !== undefined && o.walk < 0) {
    // 飞行姿态:双腿后收
    lFoot = [-6, -3];
    rFoot = [4, -2];
  }
  ctx.beginPath();
  ctx.moveTo(0, hipY);
  ctx.lineTo(lFoot[0], lFoot[1]);
  ctx.moveTo(0, hipY);
  ctx.lineTo(rFoot[0], rFoot[1]);
  ctx.stroke();

  // ---- 躯干 ----
  const tint = o.bodyTint ?? (o.player ? "#f0f0e4" : "#e4e4dc");
  ctx.strokeStyle = BODY_BLACK;
  ctx.beginPath();
  ctx.moveTo(0, headY + headR); // 脖子
  ctx.lineTo(0, hipY);
  ctx.stroke();
  // 白甲填充(粗一点的浅色芯)
  ctx.strokeStyle = tint;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, shoulderY);
  ctx.lineTo(0, hipY + 2);
  ctx.stroke();
  ctx.lineWidth = LINE;
  ctx.strokeStyle = BODY_BLACK;
  // 躯干描边
  ctx.beginPath();
  ctx.moveTo(0, headY + headR);
  ctx.lineTo(0, hipY);
  ctx.stroke();

  // ---- 头 ----
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, headY, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = BODY_BLACK;
  ctx.stroke();

  // ---- 头盔/帽 ----
  if (o.player) {
    // 金色尖刺头盔
    ctx.fillStyle = "#e8a808";
    ctx.beginPath();
    ctx.moveTo(-headR - 1, headY - 2);
    ctx.lineTo(0, headY - headR - 6);
    ctx.lineTo(headR + 1, headY - 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = STROKE;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else if (o.cap) {
    // 白色军帽
    ctx.fillStyle = "#f4f4ee";
    ctx.beginPath();
    ctx.arc(0, headY - 1.5, headR + 1, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = STROKE;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // ---- 武器/装备 ----
  drawEquipment(ctx, o, shoulderY);

  // ---- 冻结冰壳 ----
  if (o.frozen) {
    ctx.fillStyle = "rgba(160, 220, 255, 0.55)";
    ctx.strokeStyle = "rgba(220, 245, 255, 0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-9, -42, 18, 44, 4);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

function drawEquipment(ctx: CanvasRenderingContext2D, o: StickOpts, shoulderY: number): void {
  const f = o.facing;
  const aim = o.aim ?? (f === 1 ? 0 : Math.PI);
  const muzzleDx = Math.cos(aim);
  const muzzleDy = Math.sin(aim);

  ctx.strokeStyle = BODY_BLACK;
  ctx.lineWidth = 3;

  // 炮筒(士兵主武器):绕肩部(0, shoulderY+1)旋转
  if (o.cannon) {
    drawCannon(ctx, 0, shoulderY + 2, aim, 26, 9);
    // 扶炮手臂
    ctx.beginPath();
    ctx.moveTo(0, shoulderY + 1);
    ctx.lineTo(muzzleDx * 10, shoulderY + 2 + muzzleDy * 10);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, shoulderY + 1);
    ctx.lineTo(muzzleDx * 5, shoulderY + 2 + muzzleDy * 5 + 6);
    ctx.stroke();
    return;
  }

  switch (o.equipment) {
    case "umbrella": {
      // 举伞:伞在头顶
      const ux = 0;
      const uy = -48;
      ctx.strokeStyle = STROKE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ux, uy, 14, Math.PI, 0);
      ctx.closePath();
      ctx.fillStyle = "#e8a808";
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ux, uy);
      ctx.lineTo(ux, uy + 14);
      ctx.stroke();
      // 手臂举伞
      ctx.strokeStyle = BODY_BLACK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, shoulderY + 1);
      ctx.lineTo(2, uy + 12);
      ctx.stroke();
      break;
    }
    case "repair": {
      // 工具箱在手
      ctx.fillStyle = "#c87828";
      ctx.strokeStyle = STROKE;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(f * 10 - 5, shoulderY + 4, 11, 9);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(f * 10 - 2, shoulderY + 4);
      ctx.lineTo(f * 10 - 2, shoulderY + 1);
      ctx.stroke();
      // 手臂
      ctx.strokeStyle = BODY_BLACK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, shoulderY + 1);
      ctx.lineTo(f * 10, shoulderY + 6);
      ctx.stroke();
      break;
    }
    case "freeze": {
      // 冰蓝身体 + 头顶雪花
      ctx.fillStyle = "#9adcf8";
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const sx = Math.cos(a) * 5;
        const sy = -52 + Math.sin(a) * 5;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
        const a2 = ((i + 0.5) / 6) * Math.PI * 2;
        ctx.lineTo(Math.cos(a2) * 2, -52 + Math.sin(a2) * 2);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#4aa8d8";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      break;
    }
    case "burn": {
      // 背后一团火
      drawFlame(ctx, -f * 7, shoulderY - 4, 8, "#e86818");
      drawFlame(ctx, f * 4, shoulderY - 10, 6, "#f8a808");
      break;
    }
    case "ice": {
      // 脚边冰块
      ctx.fillStyle = "rgba(170, 225, 250, 0.85)";
      ctx.strokeStyle = "#5cb8e8";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(f * 8 - 6, -12, 12, 12, 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "jet": {
      // 喷气背包 + 尾焰(飞行姿态)
      ctx.fillStyle = "#606870";
      ctx.strokeStyle = STROKE;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(-f * 6 - 4, shoulderY - 2, 9, 12, 2);
      ctx.fill();
      ctx.stroke();
      drawFlame(ctx, -f * 2, 4, 9, "#f8b808");
      break;
    }
    case "dagger": {
      // 短匕首前刺
      ctx.strokeStyle = STROKE;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(f * 8, shoulderY + 4);
      ctx.lineTo(f * 17, shoulderY + 1);
      ctx.stroke();
      ctx.strokeStyle = "#c02020";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(f * 8, shoulderY + 4);
      ctx.lineTo(f * 11, shoulderY + 3.5);
      ctx.stroke();
      // 手臂
      ctx.strokeStyle = BODY_BLACK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, shoulderY + 1);
      ctx.lineTo(f * 8, shoulderY + 4);
      ctx.stroke();
      break;
    }
    case "push": {
      // 粗壮双臂前推
      ctx.strokeStyle = BODY_BLACK;
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(0, shoulderY + 1);
      ctx.lineTo(f * 14, shoulderY - 1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, shoulderY + 1);
      ctx.lineTo(f * 14, shoulderY + 6);
      ctx.stroke();
      ctx.fillStyle = "#f0f0e4";
      ctx.beginPath();
      ctx.arc(f * 14, shoulderY - 1, 3, 0, Math.PI * 2);
      ctx.arc(f * 14, shoulderY + 6, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = STROKE;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      break;
    }
    case "rifle": {
      // 步枪平举
      ctx.strokeStyle = STROKE;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(f * 3, shoulderY + 3);
      ctx.lineTo(f * 18, shoulderY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(f * 10, shoulderY + 1);
      ctx.lineTo(f * 12, shoulderY + 6);
      ctx.stroke();
      // 手臂
      ctx.strokeStyle = BODY_BLACK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, shoulderY + 1);
      ctx.lineTo(f * 10, shoulderY + 2);
      ctx.stroke();
      break;
    }
    case "bombs": {
      // 怀抱三枚小炸弹
      for (let i = 0; i < 3; i++) {
        drawBombShape(ctx, f * (4 + i * 5), shoulderY + 3 + (i % 2) * 3, 3.5);
      }
      break;
    }
    case "timed": {
      // 手持大圆炸弹 + 引信火花
      drawBombShape(ctx, f * 9, shoulderY + 2, 5.5);
      ctx.strokeStyle = BODY_BLACK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, shoulderY + 1);
      ctx.lineTo(f * 8, shoulderY + 2);
      ctx.stroke();
      ctx.fillStyle = "#ffd040";
      ctx.beginPath();
      ctx.arc(f * 9 + 2, shoulderY - 5, 1.8, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "shovel": {
      // 铁锹
      ctx.strokeStyle = STROKE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(f * 6, shoulderY - 8);
      ctx.lineTo(f * 12, shoulderY + 8);
      ctx.stroke();
      ctx.fillStyle = "#a0a8b0";
      ctx.beginPath();
      ctx.ellipse(f * 12.5, shoulderY + 10, 4, 5, 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // 手臂
      ctx.strokeStyle = BODY_BLACK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, shoulderY + 1);
      ctx.lineTo(f * 7, shoulderY - 4);
      ctx.stroke();
      break;
    }
    case "suicide": {
      // 红躯干 + 胸前炸弹
      ctx.strokeStyle = "#c02020";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(0, shoulderY);
      ctx.lineTo(0, -13);
      ctx.stroke();
      drawBombShape(ctx, 0, shoulderY + 6, 4);
      break;
    }
    default:
      // 无装备:垂手
      ctx.strokeStyle = BODY_BLACK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, shoulderY + 1);
      ctx.lineTo(f * 6, shoulderY + 10);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, shoulderY + 1);
      ctx.lineTo(-f * 6, shoulderY + 10);
      ctx.stroke();
      break;
  }
}

/** 炮筒:圆头短管,后座粗、管口细,带一道箍 */
export function drawCannon(ctx: CanvasRenderingContext2D, px: number, py: number, angle: number, len = 26, wd = 9): void {
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(angle);
  ctx.fillStyle = "#3a4048";
  ctx.strokeStyle = STROKE;
  ctx.lineWidth = 2;
  roundRectPath(ctx, -6, -wd / 2, len + 6, wd, 3.5);
  ctx.fill();
  ctx.stroke();
  // 管箍
  ctx.fillStyle = "#5a646e";
  roundRectPath(ctx, len - 10, -wd / 2 - 1.2, 5, wd + 2.4, 2);
  ctx.fill();
  ctx.stroke();
  // 管口
  ctx.fillStyle = "#101418";
  ctx.beginPath();
  ctx.ellipse(len + 5, 0, 2.2, wd / 2 - 1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawFlame(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.quadraticCurveTo(x + h * 0.55, y - h * 0.3, x, y + h * 0.3);
  ctx.quadraticCurveTo(x - h * 0.55, y - h * 0.3, x, y - h);
  ctx.fill();
}

export function drawBombShape(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.fillStyle = "#20242a";
  ctx.strokeStyle = STROKE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
}

/** 弹药小人投影在空中的姿态(翻滚) */
export function drawAmmoBody(ctx: CanvasRenderingContext2D, w: WeaponDef, x: number, y: number, tumble: number, chute = false, trail = false): void {
  const equip = equipOf(w);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tumble);
  ctx.translate(-x, -y);
  drawStickman(ctx, {
    x,
    y,
    facing: 1,
    equipment: equip,
    walk: -1, // 收腿姿态
    scale: 0.85,
  });
  ctx.restore();
  if (chute) {
    // 降落伞
    const cy = y - 34;
    ctx.fillStyle = "#e86818";
    ctx.strokeStyle = STROKE;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, cy, 16, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 14, cy);
    ctx.lineTo(x, y - 24);
    ctx.lineTo(x + 14, cy);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

export function equipOf(w: WeaponDef): EquipKey {
  if (w.custom) {
    const map: Record<string, EquipKey> = {
      umbrella: "umbrella",
      repair: "repair",
      freeze: "freeze",
      burn: "burn",
      ice: "ice",
      tumbler: "jet",
      stab: "dagger",
      push: "push",
      elite: "rifle",
      timed: "timed",
      dig: "shovel",
      suicide: "suicide",
    };
    return map[w.custom] ?? "none";
  }
  if (w.key === "rocket") return "rocket";
  if (w.key === "ripper") return "bombs";
  return "none";
}

/** 武器栏图标:小人在格子里 */
export function drawWeaponIcon(ctx: CanvasRenderingContext2D, w: WeaponDef, cw: number, ch: number): void {
  ctx.clearRect(0, 0, cw, ch);
  const cx = cw / 2;
  const feetY = ch - 6;

  if (w.key === "rocket") {
    // 火箭弹:斜置火箭
    ctx.save();
    ctx.translate(cx - 2, ch / 2 + 2);
    ctx.rotate(-0.7);
    ctx.fillStyle = "#c8ccd4";
    ctx.strokeStyle = STROKE;
    ctx.lineWidth = 1.5;
    roundRectPath(ctx, -6, -3.5, 18, 7, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#c02020";
    ctx.beginPath();
    ctx.moveTo(12, -3.5);
    ctx.lineTo(17, 0);
    ctx.lineTo(12, 3.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#e8a808";
    ctx.beginPath();
    ctx.moveTo(-6, -3.5);
    ctx.lineTo(-11, -6);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-11, 6);
    ctx.lineTo(-6, 3.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    drawFlame(ctx, -12, 0, 7, "#f8b808");
    ctx.restore();
    return;
  }
  if (w.key === "ripper") {
    drawStickman(ctx, { x: cx, y: feetY, facing: 1, equipment: "bombs", scale: 0.8 });
    return;
  }
  if (w.key === "default") {
    drawStickman(ctx, { x: cx, y: feetY, facing: 1, cannon: true, aim: -0.5, player: true, scale: 0.8 });
    return;
  }
  drawStickman(ctx, { x: cx, y: feetY, facing: 1, equipment: equipOf(w), scale: 0.8 });
}

/** 黑色圆炸弹(默认炮弹/空投弹) */
export function drawBomb(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, spin: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spin);
  drawBombShape(ctx, 0, 0, r);
  ctx.restore();
}

/** 火箭弹飞行体 */
export function drawRocketBody(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = "#c8ccd4";
  ctx.strokeStyle = STROKE;
  ctx.lineWidth = 1.5;
  roundRectPath(ctx, -8, -4, 18, 8, 3.5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#c02020";
  ctx.beginPath();
  ctx.moveTo(10, -4);
  ctx.lineTo(15, 0);
  ctx.lineTo(10, 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#e8a808";
  ctx.beginPath();
  ctx.moveTo(-8, -4);
  ctx.lineTo(-13, -7);
  ctx.lineTo(-8, 0);
  ctx.lineTo(-13, 7);
  ctx.lineTo(-8, 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
