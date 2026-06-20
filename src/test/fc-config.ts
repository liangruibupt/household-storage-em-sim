// 属性测试（fast-check）的统一配置约定
//
// 设计文档要求：每条正确性属性以单个属性测试实现，最少运行 100 次迭代
// （numRuns: 100），并使用确定性 seed 以保证测试可复现。
//
// 各属性测试应导入 FC_PARAMS（或在此基础上覆盖 numRuns/seed），
// 例如：fc.assert(fc.property(arb, predicate), FC_PARAMS)
import type { Parameters as FcParameters } from "fast-check";

/** 每条属性的最小迭代次数（与设计文档一致） */
export const NUM_RUNS = 100;

/** 确定性 seed，保证属性测试结果可复现 */
export const FC_SEED = 0x5eed;

/** fast-check 统一参数：固定 numRuns 与 seed */
export const FC_PARAMS: FcParameters<unknown> = {
  numRuns: NUM_RUNS,
  seed: FC_SEED,
};
