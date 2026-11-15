// 商店:买武器 / 升级(最多 upMax 次) / 补货(按 restockCost 单价补满)
// 原版文案:cost: $ / upgrade cost: $ / You don't have enough money! 等

import { WEAPONS, SHOP_COUNT } from "../data/weapons";
import { drawWeaponIcon } from "../battle/figures";
import type { GameSession } from "./Hud";

export class Shop {
  private listEl: HTMLElement;
  private moneyEl: HTMLElement;
  private msgEl: HTMLElement;
  private rows: { wIdx: number; root: HTMLElement; lvEl: HTMLElement; buyBtn: HTMLButtonElement; upBtn: HTMLButtonElement; restockBtn: HTMLButtonElement }[] = [];

  constructor(
    root: HTMLElement,
    private sessionGetter: () => GameSession | null,
    private onLeave: () => void
  ) {
    this.listEl = root.querySelector("#shop-list")!;
    this.moneyEl = root.querySelector("#shop-money")!;
    this.msgEl = root.querySelector("#shop-msg")!;
    (root.querySelector("#btn-shop-next") as HTMLButtonElement).addEventListener("click", () => this.onLeave());

    for (let i = 1; i <= SHOP_COUNT; i++) {
      const w = WEAPONS[i];
      if (w.hidden) continue; // 已移除的武器不进商店
      const row = document.createElement("div");
      row.className = "shop-item";
      const cv = document.createElement("canvas");
      cv.width = 42;
      cv.height = 48;
      drawWeaponIcon(cv.getContext("2d")!, w, 42, 48);
      row.appendChild(cv);

      const info = document.createElement("div");
      info.className = "s-info";
      info.innerHTML = `
        <div class="s-name">${w.name} <small>${w.en}</small> <span class="s-lv"></span></div>
        <div class="s-desc">${w.desc}</div>
      `;
      row.appendChild(info);

      const btns = document.createElement("div");
      btns.className = "s-btns";
      const buyBtn = mkBtn(`购买 $${w.cost}`, "buy");
      const upBtn = mkBtn(w.upCost > 0 ? `升级 $${w.upCost}` : "不可升级", "up");
      const restockBtn = mkBtn(`补货 $${w.restockCost}/发`, "restock");
      btns.append(buyBtn, upBtn, restockBtn);
      row.appendChild(btns);

      this.listEl.appendChild(row);

      const lvEl = row.querySelector(".s-lv") as HTMLElement;
      const rec = { wIdx: i, root: row, lvEl, buyBtn, upBtn, restockBtn };
      this.rows.push(rec);

      buyBtn.addEventListener("click", () => this.buy(i));
      upBtn.addEventListener("click", () => this.upgrade(i));
      restockBtn.addEventListener("click", () => this.restock(i));
    }
  }

  private msg(text: string): void {
    this.msgEl.textContent = text;
    window.setTimeout(() => {
      if (this.msgEl.textContent === text) this.msgEl.textContent = " ";
    }, 1600);
  }

  buy(idx: number): void {
    const s = this.sessionGetter();
    if (!s) return;
    const w = WEAPONS[idx];
    const have = s.ammo(idx) ?? 0;
    if (have >= w.carryMax) {
      this.msg("Maximum number of units for this weapon reached!");
      return;
    }
    if (s.money < w.cost) {
      this.msg("You don't have enough money!");
      return;
    }
    s.money -= w.cost;
    s.setAmmo(idx, have + 1);
    this.refresh();
  }

  upgrade(idx: number): void {
    const s = this.sessionGetter();
    if (!s) return;
    const w = WEAPONS[idx];
    const lv = s.weaponLevel(idx);
    if (w.upMax === 0 || lv >= w.upMax) {
      this.msg("No more upgrades available!");
      return;
    }
    if (s.money < w.upCost) {
      this.msg("You don't have enough money!");
      return;
    }
    s.money -= w.upCost;
    s.levelMap.set(idx, lv + 1);
    this.refresh();
  }

  restock(idx: number): void {
    const s = this.sessionGetter();
    if (!s) return;
    const w = WEAPONS[idx];
    const have = s.ammo(idx) ?? 0;
    if (have <= 0) {
      this.msg("先购买一件该武器!");
      return;
    }
    if (have >= w.carryMax) {
      this.msg("Maximum number of units for this weapon reached!");
      return;
    }
    const fill = w.carryMax - have;
    const cost = fill * w.restockCost;
    if (s.money < cost) {
      // 买不起整批:按单发尽量买
      const canAfford = Math.floor(s.money / Math.max(1, w.restockCost));
      if (canAfford <= 0) {
        this.msg("You don't have enough money!");
        return;
      }
      s.money -= canAfford * w.restockCost;
      s.setAmmo(idx, have + canAfford);
      this.msg(`补了 ${canAfford} 发(钱不够补满)`);
      this.refresh();
      return;
    }
    s.money -= cost;
    s.setAmmo(idx, w.carryMax);
    this.refresh();
  }

  refresh(): void {
    const s = this.sessionGetter();
    if (!s) return;
    this.moneyEl.textContent = `$${s.money}`;
    for (const rec of this.rows) {
      const i = rec.wIdx;
      const w = WEAPONS[i];
      const lv = s.weaponLevel(i);
      rec.lvEl.textContent = lv > 0 ? `Lv.${lv}` : "";
      const have = s.ammo(i);
      rec.buyBtn.textContent = `购买 $${w.cost}`;
      rec.buyBtn.disabled = have >= w.carryMax || s.money < w.cost;
      if (w.upMax > 0 && lv < w.upMax) {
        rec.upBtn.textContent = `升级 $${w.upCost}`;
        rec.upBtn.disabled = s.money < w.upCost;
      } else {
        rec.upBtn.textContent = "MAX";
        rec.upBtn.disabled = true;
      }
      rec.restockBtn.textContent = `补货 $${w.restockCost}/发`;
      rec.restockBtn.disabled = have <= 0 || have >= w.carryMax || s.money < w.restockCost;
    }
  }

  show(): void {
    this.refresh();
    this.msgEl.textContent = " ";
  }
}

function mkBtn(label: string, kind: "buy" | "up" | "restock"): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = kind === "restock" ? "s-btn restock" : "s-btn";
  b.textContent = label;
  return b;
}
