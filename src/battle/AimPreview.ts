// 力度指示器:从炮口画一条直线,长度随力度变化,线上显示力度百分比
// 直线方向 = 当前瞄准方向(与真实开火方向一致)

import type { Battle } from "./Battle";

export function drawAimPreview(ctx: CanvasRenderingContext2D, b: Battle): void {
  const p = b.player;
  if (!p || !p.alive || b.status !== "playing") return;

  const power = p.lastPower; // 0.25 ~ 1
  const mx = p.x + Math.cos(p.aimAngle) * 26;
  const my = p.y - 30 + Math.sin(p.aimAngle) * 26;
  const len = 34 + power * 116; // 力度越大线越长
  const ex = mx + Math.cos(p.aimAngle) * len;
  const ey = my + Math.sin(p.aimAngle) * len;

  ctx.save();

  // 主线(白,力度越大越亮)
  ctx.globalAlpha = 0.45 + 0.45 * power;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(mx, my);
  ctx.lineTo(ex, ey);
  ctx.stroke();

  // 箭头
  ctx.fillStyle = "#ffcc00";
  const a = p.aimAngle;
  const s = 7;
  ctx.beginPath();
  ctx.moveTo(ex + Math.cos(a) * s, ey + Math.sin(a) * s);
  ctx.lineTo(ex + Math.cos(a + 2.5) * s, ey + Math.sin(a + 2.5) * s);
  ctx.lineTo(ex + Math.cos(a - 2.5) * s, ey + Math.sin(a - 2.5) * s);
  ctx.closePath();
  ctx.fill();

  // 力度文本(线端外侧)
  ctx.globalAlpha = 1;
  ctx.font = '15px "Patrick Hand", "Segoe Print", cursive';
  ctx.textAlign = "center";
  const tx = ex + Math.cos(a) * 18;
  const ty = ey + Math.sin(a) * 18 + 5;
  const label = `${Math.round(power * 100)}%`;
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#1a1208";
  ctx.strokeText(label, tx, ty);
  ctx.fillStyle = power >= 1 ? "#ffcc00" : "#ffffff";
  ctx.fillText(label, tx, ty);

  ctx.restore();
}
