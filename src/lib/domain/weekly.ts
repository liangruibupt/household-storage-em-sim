// 领域算法：7 天充放电数据零填充聚合
// 对应需求：3.2（按日期升序展示过去 7 个自然日）、3.3（恰好 7 条、覆盖含当日在内向前回溯
// 7 个连续自然日、每日唯一对应一条）、3.5（缺失自然日的充/放电量记为 0 并纳入集合）。
//
// 本文件提供纯函数 buildWeeklyRecords，不抛出异常、不产生副作用，便于属性测试复现。

import type { ChargeDischargeRecord } from "../data-access/types";

/**
 * 将 Date 按「本地自然日」格式化为 YYYY-MM-DD 字符串。
 *
 * 说明：自然日的判定与 today 参数保持同一基准（均取本地日历分量），
 * 避免因时区换算导致整体偏移一天。
 *
 * @param year 年（如 2024）
 * @param month 月（0-11，符合 JS Date 语义）
 * @param day 日（1-31）
 * @returns 形如 "2024-01-09" 的自然日字符串
 */
function formatNaturalDay(year: number, month: number, day: number): string {
  // 月份从 0 开始，需加 1 后补零；日同样补零，保证恒为 YYYY-MM-DD 定长格式
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * 生成恰好 7 条、按日期升序、含当日在内向前回溯 7 个连续自然日的充放电记录集合，
 * 原始数据中缺失的自然日其 chargeKwh 与 dischargeKwh 均零填充为 0。
 *
 * 不变量（对应 Property 7 / 需求 3.2、3.3、3.5）：
 * - 输出长度恒为 7；
 * - 日期为「含当日在内、向前回溯」的 7 个连续自然日；
 * - 按日期严格升序排列；
 * - 每个自然日恰好对应一条记录（无重复、无遗漏）；
 * - 原始数据缺失的自然日充/放电量均为 0。
 *
 * 该函数为纯函数，不修改入参、不抛出异常。
 *
 * @param raw 原始充放电记录集合（可能存在缺失日、重复日或落在窗口之外的记录）
 * @param today 「今天」的时间点，自然日取其本地日历分量
 * @returns 恰好 7 条、按日期升序排列且已零填充的充放电记录
 */
export function buildWeeklyRecords(
  raw: ChargeDischargeRecord[],
  today: Date
): ChargeDischargeRecord[] {
  // 取 today 的本地日历分量作为窗口右端（含当日），后续日期运算与格式化均以此为同一基准
  const baseYear = today.getFullYear();
  const baseMonth = today.getMonth();
  const baseDay = today.getDate();

  // 建立「日期字符串 -> 原始记录」的索引，便于按自然日快速查找；
  // 若原始数据对同一自然日存在多条记录，保留首次出现的一条，保证结果确定性。
  const rawByDate = new Map<string, ChargeDischargeRecord>();
  for (const record of raw) {
    if (!rawByDate.has(record.date)) {
      rawByDate.set(record.date, record);
    }
  }

  // 为零填充日推导归属作用域（accountId / deviceId）：
  // 多账户模型下 ChargeDischargeRecord 必须携带归属字段，缺失日同样需要补齐。
  // 这里取原始记录中首条的归属作为模板；当原始集合为空时回退为空字符串占位，
  // 由调用方（账户作用域的 Provider）在读取后统一改写为查询账户标识，
  // 从而保证函数签名不变且输出恒满足 ChargeDischargeRecord 结构契约。
  const scopeAccountId = raw.length > 0 ? raw[0].accountId : "";
  const scopeDeviceId = raw.length > 0 ? raw[0].deviceId : "";

  const result: ChargeDischargeRecord[] = [];

  // 从 6 天前回溯到当日（offset 由大到小），天然得到按日期升序的 7 条记录；
  // 使用 new Date(year, month, day - offset) 进行日期运算，
  // 可自动处理跨月与跨年边界（如 3 月 1 日向前回溯到 2 月底）。
  for (let offset = 6; offset >= 0; offset--) {
    const dayDate = new Date(baseYear, baseMonth, baseDay - offset);
    const dateKey = formatNaturalDay(
      dayDate.getFullYear(),
      dayDate.getMonth(),
      dayDate.getDate()
    );

    const matched = rawByDate.get(dateKey);
    if (matched) {
      // 命中原始数据：仅取契约所定义的字段，规避可能携带的额外属性，
      // 并保留其归属（accountId / deviceId）
      result.push({
        accountId: matched.accountId,
        deviceId: matched.deviceId,
        date: dateKey,
        chargeKwh: matched.chargeKwh,
        dischargeKwh: matched.dischargeKwh,
      });
    } else {
      // 缺失自然日：充/放电量零填充为 0（需求 3.5），归属沿用推导出的作用域模板
      result.push({
        accountId: scopeAccountId,
        deviceId: scopeDeviceId,
        date: dateKey,
        chargeKwh: 0,
        dischargeKwh: 0,
      });
    }
  }

  return result;
}
