// 素材加载与帧序列映射
// 序列帧来源:原版 SWF 提取(见 _analysis/tools/compose_alpha.ps1)

export interface FrameSeq {
  frames: HTMLImageElement[];
  fps: number; // 每帧持续帧数(60fps 步进)
  anchor: "center" | "bottom";
}

// 注意:原版位图 id 在 209 与 213 之间缺 211(提取序列跳号)
const FIRE_BIG = [...range(169, 209, 2), ...range(213, 231, 2)]; // 31 帧大火球(128px→64px 余烬),连续播放
const EMBER = range(213, 231, 2); // 10 帧余烬小火(64px,白黄色)——地面火焰用(233 不在 bits 序列)
const SMOKE_HOT = range(239, 289, 2); // 26 帧热烟云(白热→橙红→焦黑)
const SMOKE_GRAY = range(293, 321, 2); // 15 帧灰白烟
const FLASH = range(327, 347, 2); // 11 帧白闪光(斜向光束,仅冰爆使用)
const PUFF = range(842, 882, 2); // 21 帧小烟团

function range(from: number, to: number, step: number): number[] {
  const arr: number[] = [];
  for (let i = from; i <= to; i += step) arr.push(i);
  return arr;
}

class AssetStore {
  private images = new Map<string, HTMLImageElement>();
  private sounds = new Map<string, AudioBuffer>();
  ready = false;

  seqDefs: Record<string, { ids: number[]; fps: number; anchor: "center" | "bottom" }> = {
    fire: { ids: FIRE_BIG, fps: 2, anchor: "center" },
    ember: { ids: EMBER, fps: 2, anchor: "center" },
    smokeHot: { ids: SMOKE_HOT, fps: 3, anchor: "center" },
    smokeGray: { ids: SMOKE_GRAY, fps: 3, anchor: "center" },
    flash: { ids: FLASH, fps: 2, anchor: "center" },
    puff: { ids: PUFF, fps: 3, anchor: "center" },
  };

  private seqs = new Map<string, FrameSeq>();

  async loadAll(onProgress?: (p: number, total: number) => void): Promise<void> {
    const jobs: Promise<void>[] = [];
    let done = 0;
    let total = 0;

    // GitHub Pages 部署在子路径下,素材路径必须带 BASE_URL(相对路径)
    const BASE = import.meta.env.BASE_URL;

    // 图片:所有 fx 帧
    const imgList: [string, string][] = [];
    for (const [key, def] of Object.entries(this.seqDefs)) {
      for (const id of def.ids) imgList.push([`${key}_${id}`, `${BASE}assets/img/fx/${seqFile(key, id)}`]);
    }
    total += imgList.length;
    for (const [name, url] of imgList) {
      jobs.push(
        loadImage(url).then((img) => {
          this.images.set(name, img);
          done++;
          onProgress?.(done, total);
        })
      );
    }

    // 音频(映射依据波形分析:893=最大爆炸,896=爆炸,895=炮声BANG,900=呼啸发射,897=闷响发射,
    //      898=燃烧,899=冰(过零率最高),405=打击,894=定时炸弹滴答(0.5s周期),892=BGM 203s)
    const soundList: [string, string][] = [
      ["bgm", `${BASE}assets/sfx/sound_892.mp3`],
      ["big_explosion", `${BASE}assets/sfx/sound_893.mp3`],
      ["explosion", `${BASE}assets/sfx/sound_896.mp3`],
      ["shoot_a", `${BASE}assets/sfx/sound_895.mp3`],
      ["shoot_b", `${BASE}assets/sfx/sound_900.mp3`],
      ["shoot_c", `${BASE}assets/sfx/sound_897.mp3`],
      ["fire", `${BASE}assets/sfx/sound_898.mp3`],
      ["ice", `${BASE}assets/sfx/sound_899.mp3`],
      ["hit", `${BASE}assets/sfx/sound_405.mp3`],
      ["clock", `${BASE}assets/sfx/sound_894.mp3`],
    ];
    total += soundList.length;
    for (const [name, url] of soundList) {
      jobs.push(
        loadSound(url).then((buf) => {
          this.sounds.set(name, buf);
          done++;
          onProgress?.(done, total);
        })
      );
    }

    const results = await Promise.allSettled(jobs);
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      const msgs = failures.map((f) => (f as PromiseRejectedResult).reason?.message ?? String(f));
      throw new Error(`${failures.length} 项素材失败: ${msgs.slice(0, 5).join(" | ")}`);
    }

    for (const [key, def] of Object.entries(this.seqDefs)) {
      this.seqs.set(key, {
        frames: def.ids.map((id) => this.images.get(`${key}_${id}`)!),
        fps: def.fps,
        anchor: def.anchor,
      });
    }
    this.ready = true;
  }

  img(name: string): HTMLImageElement | undefined {
    return this.images.get(name);
  }

  seq(name: string): FrameSeq | undefined {
    return this.seqs.get(name);
  }

  sound(name: string): AudioBuffer | undefined {
    return this.sounds.get(name);
  }
}

function seqFile(key: string, id: number): string {
  // 生成器命名规则:bits_* → fire_<id>.png,bits3_* → smoke_<id>.png,lossless_* → lossless_<id>.png
  if (key === "fire" || key === "ember") return `fire_${id}.png`;
  if (key === "smokeHot" || key === "smokeGray") return `smoke_${id}.png`;
  return `lossless_${id}.png`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`图片加载失败: ${url}`));
    img.src = url;
  });
}

async function loadSound(url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  const arr = await res.arrayBuffer();
  // AudioContext 可能在用户手势前不可用,这里先挂起解码,手势后 resume 即可(解码本身允许)
  const ctx = getDecodeCtx();
  try {
    return await ctx.decodeAudioData(arr);
  } catch (err) {
    throw new Error(`音频解码失败: ${url}`);
  }
}

let decodeCtx: AudioContext | null = null;
function getDecodeCtx(): AudioContext {
  if (!decodeCtx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    decodeCtx = new AC();
  }
  return decodeCtx;
}

export const Assets = new AssetStore();
