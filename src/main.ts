// 入口:加载素材 → 初始化 Game

import { Assets } from "./core/Assets";
import { Game } from "./core/Game";

async function boot(): Promise<void> {
  // 加载提示写进开始屏
  const startScreen = document.getElementById("screen-start")!;
  const btnStart = document.getElementById("btn-start") as HTMLButtonElement;
  const loading = document.createElement("div");
  loading.id = "loading-text";
  loading.style.cssText = "font-family:var(--hand);font-size:20px;color:#fff;text-shadow:2px 2px 0 #1a1208;";
  loading.textContent = "加载素材中… 0%";
  startScreen.insertBefore(loading, btnStart);

  try {
    await Assets.loadAll((p, total) => {
      loading.textContent = `加载素材中… ${Math.round((p / total) * 100)}%`;
    });
  } catch (err) {
    loading.textContent = `素材加载失败: ${(err as Error).message}`;
    loading.style.color = "#ff8080";
    console.error(err);
    return;
  }
  loading.remove();
  btnStart.disabled = false;
  (document.getElementById("btn-test") as HTMLButtonElement).disabled = false;

  const game = new Game();
  (window as any).__game = game; // 调试/测试入口
}

void boot();
