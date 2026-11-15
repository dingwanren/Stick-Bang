// 游戏状态机 + 主循环(fixed 60fps) + 输入 + 页面流程
// 状态对应原版帧标签:start / playing / levelclear / shop / gameover / gamewin(暂停为覆盖层)

import { Assets } from "./Assets";
import { Audio } from "./Audio";
import { Battle } from "../battle/Battle";
import { Hud, newSession, type GameSession } from "../ui/Hud";
import { WeaponBar, WEAPON_KEYS } from "../ui/WeaponBar";
import { Shop } from "../ui/Shop";
import { LEVELS, TEST_LEVEL } from "../data/levels";
import { WEAPONS } from "../data/weapons";

export type { GameSession };

const W = 800;
const H = 600;
const PANEL_W = 76; // 左侧 HUD 面板宽
const STEP_MS = 1000 / 60;

export type GameState = "loading" | "start" | "playing" | "levelclear" | "shop" | "gameover" | "gamewin";

export class Game {
  ctxT!: CanvasRenderingContext2D;
  ctxE!: CanvasRenderingContext2D;
  ctxF!: CanvasRenderingContext2D;

  state: GameState = "loading";
  paused = false;
  session: GameSession | null = null;
  battle: Battle | null = null;

  hud!: Hud;
  weaponBar!: WeaponBar;
  shop!: Shop;

  // 输入
  private keys = new Set<string>();
  private mouseX = 400;
  private mouseY = 300;
  private clickQueued = false;
  private clickX = 0;
  private clickY = 0;

  private lastTime = 0;
  private acc = 0;
  private raf = 0;

  // 临时 DOM
  private banner: HTMLElement;
  private bannerT = 0;
  private weaponLabel: HTMLElement;
  private weaponLabelT = 0;

  constructor() {
    const stage = document.getElementById("stage")!;
    this.ctxT = (document.getElementById("cv-terrain") as HTMLCanvasElement).getContext("2d")!;
    this.ctxE = (document.getElementById("cv-entity") as HTMLCanvasElement).getContext("2d")!;
    this.ctxF = (document.getElementById("cv-fx") as HTMLCanvasElement).getContext("2d")!;

    // 舞台缩放(含左侧面板)
    const fit = () => {
      const scale = Math.min(window.innerWidth / (W + PANEL_W), window.innerHeight / H);
      const scaledW = (W + PANEL_W) * scale;
      const scaledH = H * scale;
      stage.style.left = `${(window.innerWidth - scaledW) / 2}px`;
      stage.style.top = `${(window.innerHeight - scaledH) / 2}px`;
      stage.style.transformOrigin = "top left";
      stage.style.transform = `scale(${scale})`;
    };
    window.addEventListener("resize", fit);
    fit();

    // 输入
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === "p" && this.state === "playing") this.togglePause();
      if (k === "m") {
        const muted = Audio.toggleMute();
        const btn = document.getElementById("btn-mute");
        if (btn) btn.textContent = muted ? "M×" : "M";
      }
      // 测试关:R 直接重开
      if (k === "r" && this.state === "playing" && this.session?.isTest) {
        this.startLevel();
      }
      // 弹药快捷键:1-9/0/Z/X/C/V(顺序与弹格角标一致)
      if (this.state === "playing") {
        const kIdx = WEAPON_KEYS.indexOf(k.toUpperCase());
        if (kIdx >= 0) this.weaponBar.selectSlot(kIdx);
      }
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));

    // 鼠标坐标:仅游戏三层画布上的事件才有效(弹药格图标也是 canvas,不能误触发开火)
    const isGameCanvas = (t: EventTarget | null): boolean =>
      t instanceof HTMLCanvasElement &&
      (t.id === "cv-terrain" || t.id === "cv-entity" || t.id === "cv-fx");
    const stageMouse = (e: MouseEvent) => {
      const crect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      this.mouseX = ((e.clientX - crect.left) / crect.width) * W;
      this.mouseY = ((e.clientY - crect.top) / crect.height) * H;
    };
    stage.addEventListener("mousemove", (e) => {
      if (isGameCanvas(e.target)) stageMouse(e);
    });
    // 滚轮切换弹药(跳过无弹药的格子)
    stage.addEventListener(
      "wheel",
      (e) => {
        if (this.state !== "playing") return;
        e.preventDefault();
        this.weaponBar.cycle(e.deltaY > 0 ? 1 : -1);
      },
      { passive: false }
    );
    stage.addEventListener("mousedown", (e) => {
      if (isGameCanvas(e.target)) {
        stageMouse(e);
        this.clickQueued = true;
        this.clickX = this.mouseX;
        this.clickY = this.mouseY;
      }
    });
    window.addEventListener("contextmenu", (e) => e.preventDefault());

    // 横幅(关卡开场提示)
    this.banner = document.createElement("div");
    this.banner.id = "level-banner";
    this.banner.style.cssText = `position:absolute;left:${PANEL_W}px;right:0;top:130px;text-align:center;z-index:15;
      font-family:var(--marker);font-size:44px;color:#ffcc00;
      text-shadow:-3px -3px 0 #1a1208,3px -3px 0 #1a1208,-3px 3px 0 #1a1208,3px 3px 0 #1a1208;
      pointer-events:none;opacity:0;transition:opacity .4s;`;
    document.getElementById("screens")!.appendChild(this.banner);
    const tipEl = document.createElement("div");
    tipEl.id = "level-tip";
    tipEl.style.cssText = `text-align:center;font-family:var(--hand);font-size:22px;color:#fff;
      text-shadow:2px 2px 0 #1a1208;pointer-events:none;margin-top:8px;opacity:0;transition:opacity .4s;position:absolute;left:${PANEL_W}px;right:0;top:190px;z-index:15;`;
    document.getElementById("screens")!.appendChild(tipEl);

    // 切换弹药大字提示(画布底部中央)
    this.weaponLabel = document.createElement("div");
    this.weaponLabel.id = "weapon-label";
    document.getElementById("screens")!.appendChild(this.weaponLabel);

    // UI
    this.weaponBar = new WeaponBar(
      document.getElementById("weapon-bar")!,
      () => this.session,
      (idx) => {
        this.hud.refreshPreview();
        this.showWeaponLabel(idx);
        Audio.play("hit", { vol: 0.3, rate: 1.6 });
      }
    );
    this.hud = new Hud(
      document.getElementById("side-hud")!,
      () => this.session,
      () => Audio.toggleMute(),
      () => this.togglePause(),
      () => this.showScreen("screen-quit")
    );
    this.shop = new Shop(
      document.getElementById("screen-shop")!,
      () => this.session,
      () => this.gotoNextLevel()
    );

    // 屏幕按钮
    document.getElementById("btn-start")!.addEventListener("click", () => this.startNewRun(0));
    document.getElementById("btn-test")!.addEventListener("click", () => this.startTestRun());
    document.getElementById("btn-shop")!.addEventListener("click", () => this.showShop());
    document.getElementById("btn-next")!.addEventListener("click", () => this.gotoNextLevel());
    document.getElementById("btn-continue")!.addEventListener("click", () => {
      if (this.session?.isTest) {
        this.startTestRun();
        return;
      }
      const lv = this.session?.levelIdx ?? 0;
      this.startNewRun(lv);
    });
    document.getElementById("btn-tomenu")!.addEventListener("click", () => this.toStart());
    document.getElementById("btn-win-menu")!.addEventListener("click", () => this.toStart());
    document.getElementById("btn-quit-yes")!.addEventListener("click", () => this.toStart());
    document.getElementById("btn-quit-no")!.addEventListener("click", () => {
      this.showScreen(null);
      this.paused = false;
    });

    // 主循环
    this.lastTime = performance.now();
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(100, t - this.lastTime);
      this.lastTime = t;
      this.acc += dt;
      let stepped = false;
      while (this.acc >= STEP_MS) {
        this.acc -= STEP_MS;
        this.step();
        stepped = true;
      }
      if (stepped) this.render();
      // 横幅计时
      if (this.bannerT > 0) {
        this.bannerT--;
        if (this.bannerT === 0) {
          this.banner.style.opacity = "0";
          (document.getElementById("level-tip") as HTMLElement).style.opacity = "0";
        }
      }
      // 弹药切换提示计时
      if (this.weaponLabelT > 0) {
        this.weaponLabelT--;
        if (this.weaponLabelT === 0) this.weaponLabel.style.opacity = "0";
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  // ---------- 流程 ----------

  showScreen(id: string | null): void {
    for (const el of document.querySelectorAll<HTMLElement>("#screens > .screen")) {
      el.classList.add("hidden");
    }
    if (id) document.getElementById(id)!.classList.remove("hidden");
    // 非战斗屏时隐藏关卡横幅
    if (id !== null) {
      this.banner.style.opacity = "0";
      (document.getElementById("level-tip") as HTMLElement).style.opacity = "0";
      this.bannerT = 0;
    }
  }

  togglePause(): void {
    if (this.state !== "playing") return;
    this.paused = !this.paused;
    this.showScreen(this.paused ? "screen-pause" : null);
  }

  startNewRun(levelIdx: number): void {
    Audio.ensure();
    Audio.startBgm();
    this.session = newSession(levelIdx);
    this.startLevel();
  }

  /** 测试关:全弹药,敌人重生,R 重开 */
  startTestRun(): void {
    Audio.ensure();
    Audio.startBgm();
    this.session = newSession(0);
    this.session.isTest = true;
    // 备满全部武器(跳过已移除的 hidden)
    for (let i = 1; i < WEAPONS.length - 1; i++) {
      if (WEAPONS[i].hidden) continue;
      this.session.setAmmo(i, WEAPONS[i].carryMax);
    }
    this.startLevel();
  }

  startLevel(): void {
    const s = this.session!;
    const level = s.isTest ? TEST_LEVEL : LEVELS[s.levelIdx];
    this.battle = new Battle(this, s, level);
    this.state = "playing";
    this.paused = false;
    this.showScreen(null);
    document.getElementById("side-hud")!.classList.remove("hidden");
    this.hud.setLevel(s.isTest ? "TEST" : s.levelIdx + 1);
    this.hud.refreshMoney();
    this.hud.refreshPreview();
    this.weaponBar.select(s.currentWeapon);
    this.weaponBar.refresh();

    // 关卡横幅
    this.banner.textContent = s.isTest ? `试验场 · 按R重开` : `LEVEL ${s.levelIdx + 1} · ${level.name}`;
    this.banner.style.opacity = "1";
    const tip = document.getElementById("level-tip") as HTMLElement;
    tip.textContent = level.tip ?? "";
    tip.style.opacity = "1";
    this.bannerT = s.isTest ? 150 : 210;
  }

  showLevelClear(): void {
    this.state = "levelclear";
    document.getElementById("clear-info")!.textContent = `SCORE: ${this.session!.score}   |   MONEY: $${this.session!.money}`;
    this.showScreen("screen-clear");
  }

  showShop(): void {
    this.state = "shop";
    this.showScreen("screen-shop");
    this.shop.show();
  }

  gotoNextLevel(): void {
    const s = this.session!;
    if (s.levelIdx + 1 >= LEVELS.length) {
      this.showWin();
      return;
    }
    s.levelIdx++;
    this.startLevel();
  }

  showGameOver(): void {
    this.state = "gameover";
    document.getElementById("over-info")!.textContent = `SCORE: ${this.session!.score}`;
    this.showScreen("screen-over");
  }

  showWin(): void {
    this.state = "gamewin";
    document.getElementById("win-info")!.textContent = `TOTAL SCORE: ${this.session!.score}`;
    this.showScreen("screen-win");
  }

  toStart(): void {
    this.state = "start";
    this.paused = false;
    this.battle = null;
    this.session = null;
    document.getElementById("side-hud")!.classList.add("hidden");
    this.showScreen("screen-start");
  }

  onBattleEnd(status: "win" | "lose"): void {
    if (status === "win") this.showLevelClear();
    else this.showGameOver();
  }

  onMoneyChange(): void {
    this.hud.refreshMoney();
    this.hud.refreshPreview();
  }

  /** 切换弹药时的大字提示:武器名 + 类别 */
  showWeaponLabel(idx: number): void {
    const w = WEAPONS[idx];
    const cat = { ballistic: "抛射", ground: "落地单位", flyer: "自飞", parachute: "伞降" }[w.launcher] ?? "";
    this.weaponLabel.textContent = `${w.name} · ${w.en}〔${cat}〕`;
    this.weaponLabel.style.opacity = "1";
    this.weaponLabelT = 85;
  }

  toast(msg: string): void {
    const el = document.getElementById("toast")!;
    el.textContent = msg;
    el.classList.remove("hidden");
    window.clearTimeout((this as any)._toastT);
    (this as any)._toastT = window.setTimeout(() => el.classList.add("hidden"), 1200);
  }

  // ---------- 循环 ----------

  private step(): void {
    if (this.state !== "playing" || !this.battle || this.paused) return;
    const b = this.battle;
    const p = b.player;
    const input = {
      left: this.keys.has("arrowleft") || this.keys.has("a"),
      right: this.keys.has("arrowright") || this.keys.has("d"),
      mouseX: this.mouseX,
      mouseY: this.mouseY,
      fire: this.clickQueued,
      fireTargetX: this.clickX,
    };
    this.clickQueued = false;
    b.step(input);
    void p;
  }

  private render(): void {
    if (this.state === "playing" && this.battle) {
      this.battle.render(this.ctxT, this.ctxE, this.ctxF);
    }
  }
}
