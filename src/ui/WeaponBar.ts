// 弹药栏:左侧面板 2 列弹格(1 默认 + 13 购买),弹药即小人图标
// 每格带快捷键角标(1-9,0,Z/X/C/V)+ 类别色条;支持滚轮/按键切换

import { WEAPONS, SHOP_COUNT } from "../data/weapons";
import { drawWeaponIcon } from "../battle/figures";
import type { GameSession } from "./Hud";

/** 弹格快捷键(顺序与弹格一致;游戏内按键/滚轮切换) */
export const WEAPON_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "Z", "X", "C", "V"];

const CAT_COLOR: Record<string, string> = {
  ballistic: "#e86818", // 抛射弹:橙
  ground: "#68a808", // 落地单位:绿
  flyer: "#4aa0e8", // 自飞:蓝
  parachute: "#a060e8", // 伞降:紫
};

export class WeaponBar {
  private slots: HTMLButtonElement[] = [];
  private counts: HTMLDivElement[] = [];
  private slotIdx: number[] = []; // 槽位对应的武器 idx(跳过 hidden)
  private iconCtx: CanvasRenderingContext2D[] = [];
  selected = 0;

  constructor(
    private container: HTMLElement,
    private sessionGetter: () => GameSession | null,
    private onSelect: (idx: number) => void
  ) {
    // 0=默认 + 可购买(hidden 的跳过)
    let k = 0;
    for (let i = 0; i <= SHOP_COUNT; i++) {
      if (WEAPONS[i].hidden) continue;
      const btn = document.createElement("button");
      btn.className = "wslot";
      btn.title = `[${WEAPON_KEYS[k]}] ${WEAPONS[i].name} · ${WEAPONS[i].en}`;
      // 类别色条
      const cat = document.createElement("div");
      cat.className = "cat";
      cat.style.background = CAT_COLOR[WEAPONS[i].launcher] ?? "#888";
      btn.appendChild(cat);
      // 快捷键角标
      const key = document.createElement("div");
      key.className = "key";
      key.textContent = WEAPON_KEYS[k] ?? "";
      btn.appendChild(key);
      // 图标
      const cv = document.createElement("canvas");
      cv.width = 36;
      cv.height = 42;
      btn.appendChild(cv);
      const cnt = document.createElement("div");
      cnt.className = "cnt";
      btn.appendChild(cnt);
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.select(i);
      });
      this.container.appendChild(btn);
      this.slots.push(btn);
      this.counts.push(cnt);
      this.slotIdx.push(i);
      this.iconCtx.push(cv.getContext("2d")!);
      this.renderIcon(i);
      k++;
    }
    this.slots[0].classList.add("sel");
  }

  private renderIcon(i: number): void {
    drawWeaponIcon(this.iconCtx[this.slotIdx.indexOf(i)], WEAPONS[i], 36, 42);
  }

  select(i: number): void {
    const s = this.sessionGetter();
    if (!s) return;
    if (i !== 0 && s.ammo(i) <= 0) return; // 没弹药不可选
    this.selected = i;
    s.currentWeapon = i;
    for (let k = 0; k < this.slots.length; k++) {
      this.slots[k].classList.toggle("sel", this.slotIdx[k] === i);
    }
    this.onSelect(i);
  }

  /** 按快捷键序号选择 */
  selectSlot(k: number): void {
    const i = this.slotIdx[k];
    if (i === undefined) return;
    this.select(i);
  }

  /** 滚轮/循环切换:跳过没弹药的非默认武器 */
  cycle(dir: 1 | -1): void {
    const s = this.sessionGetter();
    if (!s) return;
    const cur = this.slotIdx.indexOf(this.selected);
    const n = this.slotIdx.length;
    for (let step = 1; step <= n; step++) {
      const k = (cur + dir * step + n * 2) % n;
      const i = this.slotIdx[k];
      if (i === 0 || s.ammo(i) > 0) {
        this.select(i);
        return;
      }
    }
  }

  refresh(): void {
    const s = this.sessionGetter();
    if (!s) return;
    for (let k = 0; k < this.slots.length; k++) {
      const i = this.slotIdx[k];
      const c = this.counts[k];
      if (i === 0 || s.isTest) {
        // 默认武器与测试关:∞
        c.textContent = "∞";
        c.classList.add("inf");
        this.slots[k].classList.remove("empty");
      } else {
        const n = s.ammo(i);
        c.textContent = String(n);
        c.classList.remove("inf");
        this.slots[k].classList.toggle("empty", n <= 0);
      }
    }
  }
}
