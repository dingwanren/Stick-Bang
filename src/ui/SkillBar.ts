// 技能栏:Q 双发 / E 散射(无尽模式专用)
// 状态流转:CD 中(遮罩+倒计时)→ 就绪 → 已武装(高亮,"下一发!")
// 击发瞬间消耗武装并起 CD(见 Soldier.fire → Battle.onSkillTriggered)

import type { Battle } from "../battle/Battle";

const SKILLS = [
  { kind: "burst" as const, key: "Q", name: "双发", cdFrames: 180, unlockText: "第3波" },
  { kind: "spread" as const, key: "E", name: "散射", cdFrames: 270, unlockText: "第5波后" },
];

export class SkillBar {
  private cells: HTMLElement[] = [];
  private cdEls: HTMLElement[] = [];
  private stateEls: HTMLElement[] = [];

  constructor(root: HTMLElement) {
    for (const s of SKILLS) {
      const cell = document.createElement("div");
      cell.className = "skill-cell";
      cell.innerHTML = `
        <div class="sk-key">${s.key}</div>
        <div class="sk-name">${s.name}</div>
        <div class="sk-cd"></div>
        <div class="sk-state"></div>
        <div class="sk-armed"></div>`;
      root.appendChild(cell);
      this.cells.push(cell);
      this.cdEls.push(cell.querySelector(".sk-cd")!);
      this.stateEls.push(cell.querySelector(".sk-state")!);
    }
  }

  /** 每帧由 Game.render 调用:同步锁定/CD/武装状态到 DOM */
  update(b: Battle | null): void {
    const show = b !== null && b.isEndless;
    for (let i = 0; i < SKILLS.length; i++) {
      const s = SKILLS[i];
      const cell = this.cells[i];
      cell.classList.toggle("off", !show);
      if (!show || !b) continue;
      const unlocked = s.kind === "burst" ? b.skillUnlocked.burst : b.skillUnlocked.spread;
      cell.classList.toggle("locked", !unlocked);
      if (!unlocked) {
        this.cdEls[i].style.height = "0%";
        this.stateEls[i].textContent = s.unlockText;
        continue;
      }
      const armed = s.kind === "burst" ? b.player.armedBurst : b.player.armedSpread;
      const cd = s.kind === "burst" ? b.skillCd.burst : b.skillCd.spread;
      cell.classList.toggle("armed", armed);
      this.cdEls[i].style.height = armed || cd <= 0 ? "0%" : `${Math.min(100, (cd / s.cdFrames) * 100)}%`;
      this.stateEls[i].textContent = armed ? "下一发!" : cd > 0 ? `${(cd / 60).toFixed(1)}s` : "就绪";
    }
  }
}
