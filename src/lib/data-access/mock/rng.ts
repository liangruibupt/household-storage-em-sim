// Mock 数据基础设施：可种子化伪随机数生成器（PRNG）（需求 5.2）
//
// 设计文档（Mock_Provider 设计 / 确定性与种子化）要求：
//   使用基于 `mulberry32` 的纯函数 PRNG，由固定 `seed` 驱动；
//   相同 seed 必须产生完全相同的随机序列，从而保证 Mock 数据的
//   确定性与可复现性，使属性测试（PBT）可稳定重放。
//
// 本模块对外提供一个工厂函数 `createRng(seed)`，返回一个携带内部状态的
// Rng 实例。Rng 实例本身在调用 `next()` 等方法时会推进内部状态，
// 但其行为完全由初始 seed 决定——即"给定相同 seed，得到相同序列"。
// 底层步进函数 mulberry32 是关于 32 位状态的纯确定性函数（无副作用、
// 不依赖全局状态、不调用 Math.random），便于测试与复现。

/**
 * 可种子化随机数生成器接口。
 *
 * 由 `createRng` 创建。所有方法在被调用时会推进生成器的内部状态，
 * 产出的序列完全由创建时的 seed 决定。
 */
export interface Rng {
  /**
   * 产出下一个 [0, 1) 区间内的浮点随机数（含 0，不含 1）。
   *
   * 返回:
   *   number: 位于 [0, 1) 的浮点数
   */
  next(): number;

  /**
   * 产出 [min, max] 闭区间内的整数随机数（含两端）。
   *
   * 参数:
   *   min (number): 下界（包含），将被向下取整
   *   max (number): 上界（包含），将被向下取整
   *
   * 返回:
   *   number: 位于 [min, max] 的整数
   */
  intInRange(min: number, max: number): number;

  /**
   * 产出 [min, max) 半开区间内的浮点随机数（含 min，不含 max）。
   *
   * 参数:
   *   min (number): 下界（包含）
   *   max (number): 上界（不包含）
   *
   * 返回:
   *   number: 位于 [min, max) 的浮点数；当 min === max 时返回 min
   */
  floatInRange(min: number, max: number): number;
}

/**
 * mulberry32 核心步进函数。
 *
 * 给定一个 32 位无符号整数状态，返回 [下一状态, [0,1) 浮点输出]。
 * 该函数为纯函数：对相同的输入状态总是返回相同的结果，不读写任何外部状态。
 *
 * 参数:
 *   state (number): 当前 32 位状态（以无符号整数语义参与运算）
 *
 * 返回:
 *   [number, number]: 元组 [下一状态, 输出浮点数(位于 [0,1))]
 */
function mulberry32Step(state: number): [number, number] {
  // 推进状态：加上固定增量常量（0x6D2B79F5），并约束在 32 位范围内
  let next = (state + 0x6d2b79f5) | 0;

  // 以下为 mulberry32 的混淆（mixing）步骤，使用 Math.imul 进行 32 位整数乘法
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

  // 取高 32 位输出并归一化到 [0, 1)：除以 2^32（4294967296）
  const output = ((t ^ (t >>> 14)) >>> 0) / 4294967296;

  // 将下一状态规整为无符号 32 位整数返回
  return [next >>> 0, output];
}

/**
 * 将任意数值 seed 归一化为一个 32 位无符号整数初始状态。
 *
 * 参数:
 *   seed (number): 调用方提供的种子（可为任意有限数值）
 *
 * 返回:
 *   number: 位于 [0, 2^32) 的无符号 32 位整数
 */
function normalizeSeed(seed: number): number {
  // 非有限值（NaN/Infinity）回退为 0，保证确定性
  if (!Number.isFinite(seed)) {
    return 0;
  }
  // 通过 >>> 0 截断为 32 位无符号整数
  return Math.trunc(seed) >>> 0;
}

/**
 * 创建一个由 seed 驱动的可种子化伪随机数生成器（mulberry32）。
 *
 * 相同的 seed 将产生完全相同的随机序列，从而保证 Mock 数据的可复现性
 * （需求 5.2）。返回的 Rng 实例在调用其方法时推进内部状态。
 *
 * 参数:
 *   seed (number): 种子值。相同 seed 决定相同序列
 *
 * 返回:
 *   Rng: 可种子化随机数生成器实例
 */
export function createRng(seed: number): Rng {
  // 内部 32 位状态，由 seed 归一化得到；闭包私有，外部不可直接访问
  let state = normalizeSeed(seed);

  /**
   * 产出下一个 [0, 1) 浮点数，并推进内部状态。
   */
  function next(): number {
    const [nextState, output] = mulberry32Step(state);
    state = nextState;
    return output;
  }

  return {
    next,

    intInRange(min: number, max: number): number {
      // 将边界向下取整为整数
      const lo = Math.floor(min);
      const hi = Math.floor(max);

      // 防御性处理：若上界小于下界则交换，保证区间有效
      const low = Math.min(lo, hi);
      const high = Math.max(lo, hi);

      // 闭区间 [low, high] 的取值个数
      const span = high - low + 1;

      // 映射 [0,1) 的浮点输出到 [low, high] 的整数
      return low + Math.floor(next() * span);
    },

    floatInRange(min: number, max: number): number {
      // 退化区间直接返回下界，避免产生 NaN 或越界
      if (min === max) {
        return min;
      }
      // 线性映射 [0,1) 到 [min, max)
      return min + next() * (max - min);
    },
  };
}
