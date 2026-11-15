// HUD:金钱/关卡/音频按钮/大图标预览 + GameSession 类型定义

import { WEAPONS } from "../data/weapons";
import { drawWeaponIcon } from "../battle/figures";

export interface GameSession {
  levelIdx: number;
  isTest?: boolean; // 测试关
  money: number;
  score: number;
  currentWeapon: number;
  ammoMap: Map<number, number>; // 武器idx → 携带数
  levelMap: Map<number, number>; // 武器idx → 升级等级
  ammo(idx: number): number;
  setAmmo(idx: number, n: number): void;
  weaponLevel(idx: number): number;
}

export function newSession(levelIdx: number): GameSession {
  const ammoMap = new Map<number, number>();
  const levelMap = new Map<number, number>();
  return {
    levelIdx,
    money: 0,
    score: 0,
    currentWeapon: 0,
    ammoMap,
    levelMap,
    ammo(idx) {
      if (idx === 0) return Infinity;
      return ammoMap.get(idx) ?? 0;
    },
    setAmmo(idx, n) {
      ammoMap.set(idx, n);
    },
    weaponLevel(idx) {
      return levelMap.get(idx) ?? 0;
    },
  };
}

export class Hud {
  private moneyEl: HTMLElement;
  private levelEl: HTMLElement;
  private previewCanvas: HTMLCanvasElement;
  private previewCount: HTMLElement;

  constructor(
    private root: HTMLElement,
    private sessionGetter: () => GameSession | null,
    private onMute: () => boolean,
    private onPause: () => void,
    private onMenu: () => void
  ) {
    this.moneyEl = root.querySelector("#hud-money")!;
    this.levelEl = root.querySelector("#hud-level")!;
    this.previewCanvas = root.querySelector("#preview-canvas")!;
    this.previewCount = root.querySelector("#preview-count")!;

    (root.querySelector("#btn-mute") as HTMLButtonElement).addEventListener("click", (e) => {
      e.stopPropagation();
      const muted = this.onMute();
      (e.currentTarget as HTMLButtonElement).textContent = muted ? "M×" : "M";
    });
    (root.querySelector("#btn-pause") as HTMLButtonElement).addEventListener("click", (e) => {
      e.stopPropagation();
      this.onPause();
    });
    (root.querySelector("#btn-menu") as HTMLButtonElement).addEventListener("click", (e) => {
      e.stopPropagation();
      this.onMenu();
    });
  }

  setLevel(n: number | string): void {
    this.levelEl.textContent = `LEVEL: ${n}`;
  }

  refreshMoney(): void {
    const s = this.sessionGetter();
    if (s) this.moneyEl.textContent = `$${s.money}`;
  }

  refreshPreview(): void {
    const s = this.sessionGetter();
    if (!s) return;
    const idx = s.currentWeapon;
    const ctx = this.previewCanvas.getContext("2d")!;
    drawWeaponIcon(ctx, WEAPONS[idx], 50, 44);
    const count = s.ammo(idx);
    this.previewCount.textContent = idx === 0 || s.isTest ? "∞" : String(count);
  }
}
