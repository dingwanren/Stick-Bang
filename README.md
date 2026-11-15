# Stick Bang(火柴人-炮筒战士)网页复刻版

本地运行的网页版复刻,按《复刻方案.md》实现:核心战斗、15+1 种弹药、敌人 AI、飞行敌人、商店经济、6 个关卡、序列帧特效与原版音效。

## 运行

```bash
npm install
npm run dev        # 开发服务器(默认 http://localhost:5173)
npm run build      # 产物在 dist/(本地自用,注意素材版权勿分发)
```

> 网络受限环境安装:本机 npm 走 TLS 拦截代理,安装时需 `npm_config_strict_ssl=false npm install`。

## 操作

| 按键 | 功能 |
|---|---|
| ← / → | 移动(自动贴合地形,可过桥/爬小台阶/掉坑) |
| 鼠标 | 瞄准:炮口指向鼠标,**鼠标离人物越远力度越大**(上限 100%,最近 0) |
| 左键 | 立即开火,力度决定初速——小力可轻抛到近处,全力可飞出屏幕顶再落回 |
| 滚轮 / 1-9,0,Z X C V | 切换弹药(弹格角标即快捷键;切换时画布底部大字提示武器名) |
| 点击弹药格 | 同上 |
| P | 暂停 / 继续 |
| M | 静音 |
| R | 测试关内重新开始 |

**力度指示器**:炮口伸出一条直线指示射击方向,**长度随力度变化**,末端箭头 + 力度百分比(满力显示金色 100%)。

**测试关**:开始页点"测试关(全弹药)"进入——平坦大场地、敌人(地面+飞行)存在且全灭后自动增援,**无限弹药**(栏位显示 ∞,不扣减),受击/死亡与正常关一致;按 R 随时重开,适合试弹药效果与地形破坏。

## 内容一览

- **流程**:开始页(开始游戏 / 测试关)→ 战斗 → LEVEL CLEAR(商店/下一关)→ … → YOU WIN;死亡 → GAME OVER(CONTINUE 重试本关,金钱/得分清零)
- **力度**:鼠标距人物远近决定力度(25%~100% 有上限),影响所有弹药的出膛初速(轻抛/全力);AI 恒为全力
- **布局**:弹药栏/金钱/按钮在画布左侧独立面板(舞台 76+800),不遮挡游戏画面
- **弹药**:1 把 ∞ 默认炮弹 + 14 件可购买武器(原版数值:价格/升级/携带上限),行为覆盖四种发射器:
  - 抛物线弹(默认/火箭/空爆分裂)、伞降(精英伞兵)、自飞(飞行骚扰兵)、落地行为小人(护伞/维修/冻结/燃烧/铺冰/刺杀/推挤/定时/挖洞/自爆)
  - 敌方专属第 16 号"空投弹"由飞行敌人投下
- **敌人**:地面敌人(与玩家同规格,AI 状态机:推进/保持/瞄准解算+难度误差/Kit 特殊弹药)+ 飞行敌人(宽范围随机徘徊、俯冲投弹,被击落原地一炸即消失,命中给钱)
- **地形**:离屏位图 + Uint8Array 遮罩像素碰撞(与原版 BitmapData 方案等价),爆炸挖洞、燃烧焦痕、铺冰;木桥按 40px 分段可逐段打塌(站在桥上会被摔进坑里)
- **经济**:命中得钱(直击>溅射)、击杀 +$250、SCORE=累计金钱;商店买/升级(最多 2 级)/补货
- **特效**:原版提取序列帧(火球 31 帧/热烟 26 帧/灰烟/闪光/小烟团)+ 命中飘字 + 屏震
- **关卡**:6 关数据驱动(`src/data/levels.ts`),加关 = 追加配置;地形/敌人配置见方案 §七

## 结构

```
src/
  main.ts            入口(素材加载 → Game)
  core/
    Game.ts          状态机 + 60fps 定步主循环 + 输入换算 + 各页面
    Assets.ts        图片/音频加载与序列帧映射(fire/smokeHot/smokeGray/flash/puff)
    Audio.ts         Web Audio(SFX GainNode 限音量,BGM 循环,M 静音)
  battle/
    Battle.ts        单关战斗编排(采样地面/伤害结算/金钱/胜负)
    AimPreview.ts    力度指示器(弹道预览虚线+落点标记,与真实弹丸同一物理)
    Terrain.ts       地形绘制 + 遮罩碰撞 + carve/scorch/paintIce
    Bridge.ts        可破坏桥(段 HP)
    Soldier.ts       士兵(玩家/地面敌共用,对应原版 Catapult;坠落实效/落水判定)
    FlyingEnemy.ts   飞行敌人(巡航/俯冲投弹/坠落,直击可打落、命中给钱)
    Ai.ts            敌人 AI + solveArc 抛物线解算
    figures.ts       火柴人/炮筒/武器图标绘制("弹药即小人")
    projectiles/     Ballistic / Parachute / Flyer / GroundUnit(10 种落地行为)
    effects/         Explosion(范围伤害+破坏) / GroundFx(燃烧/冰面) / Fx(序列帧/飘字/屏震)
  ui/
    Hud.ts           底栏(金钱/关卡/按钮/大图标预览) + GameSession
    WeaponBar.ts     15 格弹药栏
    Shop.ts          商店(买/升级/补货)
  data/
    weapons.ts       16 项武器表(原版数值)
    levels.ts        6 关配置
public/assets/
  img/fx/            109 张特效帧(bits/bits3 alpha 已合成,见 _analysis/tools/compose_alpha.ps1)
  sfx/               10 个原版 MP3(sound_892=BGM 203s;其余映射见 Assets.ts 注释)
  fonts/             Permanent Marker / Patrick Hand(本地字体)
```

## 素材再生成(如需)

```bash
node _analysis/tools/swf_alpha.mjs _analysis/swf-src/115762.swf _analysis/tools/out/alpha
powershell -File _analysis/tools/compose_alpha.ps1     # 重新合成 fx PNG
powershell -File _analysis/tools/contact_sheet.ps1     # 生成帧对照表
```

## 音效映射(波形分析校准)

| 文件 | 用途 | 依据 |
|---|---|---|
| sound_892 | BGM(203s 循环) | 时长 |
| sound_893 | 大爆炸(死亡/大威力) | 最响、2s 衰减 |
| sound_896 | 普通爆炸 | 2.35s 经典衰减包络 |
| sound_895 | 炮声 BANG(默认炮) | 1.02 持续轰 |
| sound_900 | 单位发射(呼啸) | 0.3s 渐强 |
| sound_897 | 火箭/空投发射(闷响) | 静默后 0.2s 短鸣 |
| sound_898 | 燃烧 | 慢起持续噼啪 |
| sound_899 | 冰冻 | 过零率最高(2587) |
| sound_405 | 命中打击 | 130ms 静默后瞬时 0.75 攻击 |
| sound_894 | 定时炸弹滴答 | 0.5s 周期脉冲 × 12s |

## 发布到 GitHub Pages

仓库已含自动部署工作流(`.github/workflows/deploy.yml`,push 到 main 自动构建并部署,构建产物为相对路径,子路径可用)。

1. 在 GitHub 新建一个**公开仓库**(Pages 需要;Pro 账号可用私有仓库)
2. 本地执行:
   ```bash
   git remote add origin https://github.com/<用户名>/<仓库名>.git
   git push -u origin main
   ```
3. 仓库 **Settings → Pages → Build and deployment → Source 选 "GitHub Actions"**
4. 推送后 Actions 自动构建部署,页面地址:`https://<用户名>.github.io/<仓库名>/`
5. 之后每次 push 到 main 自动更新页面;也可在 Actions 页手动 Run workflow

> `_analysis/`(原版 SWF 与解析工具)已在 .gitignore 中排除,不会进入公开仓库。
> **版权提醒**:公开部署意味着公开分发从原版 SWF 提取的特效图与音频,素材版权归 FreeWorldGroup——请自行评估,勿用于商业用途。

## 已知差异(有意简化)

见《复刻方案.md》§十:自设地形、无分波增援(格式已预留)、15 格弹药栏、SCORE=累计金钱、无存档、无高分榜/广告。
