// 数据提供者工厂/单例（任务 10.13，需求 5.1、5.3、5.4）
//
// 设计文档（工厂——实现可替换的关键）要求：
//   API_Layer 通过本模块的 getDataProvider() 作为获取数据提供者的「唯一入口」，
//   仅依赖 IDataProvider 抽象接口，不直接 new 任何具体实现。
//   当前阶段返回 MockProvider 单例；未来接入真实设备 API 时，仅需修改此处
//   （或按环境变量切换），API_Layer 与 Web_UI 源代码零改动即可正常运行。

import type { IDataProvider } from "./provider";
import { MockProvider } from "./mock/mock-provider";
// 未来：import { RealDeviceApiProvider } from "./real/real-provider";

/** 进程内单例实例；首次调用 getDataProvider() 时惰性创建 */
let instance: IDataProvider | null = null;

/**
 * 获取数据提供者单例。
 *
 * 这是 API_Layer 访问数据访问层的唯一入口（需求 5.1、5.4）。
 * 切换具体实现（如从 Mock 切到真实设备 API）只需修改本函数内部，
 * 调用方无需任何改动（需求 5.3）。
 *
 * @returns IDataProvider 单例实例
 */
export function getDataProvider(): IDataProvider {
  if (!instance) {
    // 未来可按 process.env.DATA_PROVIDER 选择 Real / Mock，调用方无感知
    instance = new MockProvider();
  }
  return instance;
}

/**
 * 重置单例（仅供测试使用）。
 *
 * 允许测试在用例之间重建干净的提供者实例，避免内存态在用例间相互污染。
 */
export function __resetDataProviderForTests(): void {
  instance = null;
}
