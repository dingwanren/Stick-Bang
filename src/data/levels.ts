// 关卡数据(数据驱动,加关 = 追加配置)
// 坐标约定:平台 [x, y, w, h],y = 顶面(可站立);水面即死线 waterY。
// 桥与两侧悬崖顶面齐平(y 相同),可步行通过;段 HP 打空则塌。

export interface GroundEnemyCfg {
  x: number;
  hp: number;
  kit: { w: number; count: number }[]; // w = 武器表索引
  aimError: number; // 瞄准随机误差(弧度)
  reaction: number; // 射击间隔额外帧数
  aggression: number; // 0~1 推进倾向
}

export interface FlyEnemyCfg {
  hp: number;
  patrol: [number, number];
  bombPower: number;
  reload: number;
  bombError: number;
}

export interface Level {
  name: string;
  test?: boolean; // 测试关:全弹药、敌人重生、R 重开
  terrain: {
    platforms: [number, number, number, number][];
    bridge?: { x: number; y: number; w: number; segHp: number }; // 按 40px 分段
    waterY: number;
  };
  playerStart: [number, number];
  enemies: {
    ground: GroundEnemyCfg[];
    fly: FlyEnemyCfg[];
  };
  tip?: string;
}

export const LEVELS: Level[] = [
  // L1 初遇 —— 教学关:移动/瞄准/抛物线,打桥断路
  {
    name: "初遇",
    terrain: {
      platforms: [
        [0, 480, 300, 120],
        [500, 480, 300, 120],
      ],
      bridge: { x: 300, y: 480, w: 200, segHp: 24 }, // 5 段
      waterY: 555,
    },
    playerStart: [80, 480],
    enemies: {
      ground: [{ x: 700, hp: 100, kit: [], aimError: 0.12, reaction: 50, aggression: 0.25 }],
      fly: [],
    },
    tip: "← → 移动,鼠标瞄准,左键开火。抬高炮口打远距离!",
  },
  // L2 空袭 —— 飞行敌首秀 + 坑内台阶战场 + 敌人开始用冰冻弹
  {
    name: "空袭",
    terrain: {
      platforms: [
        [0, 480, 260, 120],
        [540, 480, 260, 120],
        [280, 550, 70, 50], // 坑内左台阶
        [450, 550, 70, 50], // 坑内右台阶
        [262, 515, 18, 35], // 左壁爬出踏脚
        [520, 515, 18, 35], // 右壁爬出踏脚
      ],
      bridge: { x: 260, y: 480, w: 280, segHp: 30 }, // 7 段
      waterY: 555,
    },
    playerStart: [70, 480],
    enemies: {
      ground: [{ x: 730, hp: 100, kit: [{ w: 3, count: 2 }], aimError: 0.09, reaction: 40, aggression: 0.4 }], // w3 = Freezoid
      fly: [{ hp: 60, patrol: [280, 520], bombPower: 12, reload: 200, bombError: 0.1 }],
    },
    tip: "头顶有敌机!护伞(F1)可挡空投弹,坠落深坑还有台阶战场。",
  },
  // L3 峡谷 —— 无桥,必须抛物线越深坑;双地面敌
  {
    name: "峡谷",
    terrain: {
      platforms: [
        [0, 480, 280, 120],
        [560, 480, 240, 120],
        [620, 380, 180, 220], // 右侧高台(顶面 380)
      ],
      waterY: 555,
    },
    playerStart: [80, 480],
    enemies: {
      ground: [
        { x: 720, hp: 100, kit: [{ w: 12, count: 2 }], aimError: 0.1, reaction: 36, aggression: 0.5 }, // 高台上的火箭敌
        { x: 600, hp: 100, kit: [], aimError: 0.1, reaction: 44, aggression: 0.35 },
      ],
      fly: [],
    },
    tip: "没有桥,抛物线是你唯一的路。小心高台上的火箭兵!",
  },
  // L4 烈焰 —— 燃烧+铺冰同场,中央高台
  {
    name: "烈焰",
    terrain: {
      platforms: [
        [0, 480, 240, 120],
        [560, 480, 240, 120],
        [340, 420, 120, 180], // 中央高台(顶面 420)
      ],
      waterY: 555,
    },
    playerStart: [70, 480],
    enemies: {
      ground: [
        { x: 400, hp: 110, kit: [{ w: 4, count: 2 }], aimError: 0.09, reaction: 34, aggression: 0.45 }, // 台上燃烧敌(w4=Burnie)
        { x: 720, hp: 110, kit: [{ w: 5, count: 2 }], aimError: 0.09, reaction: 34, aggression: 0.45 }, // w5=冰面兵
      ],
      fly: [],
    },
    tip: "敌人学会了烧地与铺冰。别站在火上,小心打滑!",
  },
  // L5 制空权 —— 双飞行敌 + 地面敌同场
  {
    name: "制空权",
    terrain: {
      platforms: [
        [0, 480, 300, 120],
        [500, 480, 300, 120],
      ],
      bridge: { x: 300, y: 480, w: 200, segHp: 26 },
      waterY: 555,
    },
    playerStart: [80, 480],
    enemies: {
      ground: [{ x: 700, hp: 120, kit: [{ w: 3, count: 2 }, { w: 12, count: 2 }], aimError: 0.08, reaction: 30, aggression: 0.55 }],
      fly: [
        { hp: 70, patrol: [260, 420], bombPower: 12, reload: 180, bombError: 0.09 },
        { hp: 70, patrol: [380, 540], bombPower: 12, reload: 180, bombError: 0.09 },
      ],
    },
    tip: "双机编队!先清空中再收拾地面,护伞是保命神器。",
  },
  // L6 决战 —— 全武装地面敌 + 双飞行敌,最宽深坑
  {
    name: "决战",
    terrain: {
      platforms: [
        [0, 480, 240, 120],
        [600, 480, 200, 120],
        [390, 530, 24, 25], // 坑中石柱踏脚
      ],
      waterY: 555,
    },
    playerStart: [70, 480],
    enemies: {
      ground: [{ x: 720, hp: 150, kit: [{ w: 3, count: 2 }, { w: 4, count: 2 }, { w: 12, count: 2 }, { w: 7, count: 1 }], aimError: 0.07, reaction: 26, aggression: 0.6 }],
      fly: [
        { hp: 80, patrol: [250, 400], bombPower: 14, reload: 160, bombError: 0.08 },
        { hp: 80, patrol: [420, 560], bombPower: 14, reload: 160, bombError: 0.08 },
      ],
    },
    tip: "最终决战!带上全部家当,祝你好运,炮手!",
  },
];

// 试验场:入口按钮进入(不计入关卡流程)。全弹药、地形破坏、敌人存在且全灭后重生,R 键重开。
export const TEST_LEVEL: Level = {
  name: "试验场",
  test: true,
  terrain: {
    platforms: [
      [0, 470, 400, 130],
      [400, 470, 400, 130],
    ],
    waterY: 598, // 低于屏底,正常不会落水(挖穿底部例外)
  },
  playerStart: [100, 470],
  enemies: {
    ground: [{ x: 680, hp: 100, kit: [{ w: 3, count: 2 }, { w: 4, count: 2 }, { w: 12, count: 2 }], aimError: 0.12, reaction: 60, aggression: 0.2 }],
    fly: [{ hp: 60, patrol: [300, 620], bombPower: 10, reload: 240, bombError: 0.1 }],
  },
  tip: "所有弹药已备满。按 R 重新开始。",
};
