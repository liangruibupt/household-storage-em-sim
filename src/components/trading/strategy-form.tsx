"use client";

// 策略创建表单组件 StrategyForm（需求 4.3、4.8、4.9）
//
// 设计要点（设计文档「智能电力交易」一节）：
//   - 字段含名称、动作（charge/discharge/buy/sell）、触发条件（comparator + priceThreshold）、enabled。
//   - 提交经 POST /api/trading/strategies，权威校验在服务端（validation.ts）。
//   - 校验失败（400 VALIDATION）时，依据 error.field 在对应字段下展示错误并保留用户输入（需求 4.8、4.9）。
//   - 创建成功后重置表单并通过 onCreated 通知父级刷新列表（需求 4.3）。

import { useState } from "react";
import { sendJson } from "@/lib/http/client";
import type {
  PriceComparator,
  StrategyAction,
  TradingStrategy,
  TradingStrategyInput,
} from "@/lib/data-access/types";
import {
  ACTION_OPTIONS,
  COMPARATOR_OPTIONS,
  formatAction,
  formatComparator,
} from "./labels";

// 表单组件属性
export interface StrategyFormProps {
  /** 创建成功后的回调（通常触发列表与市场状态刷新） */
  onCreated?: () => void;
}

/** 字段级错误映射：键为字段名（与服务端 error.field 对齐），值为中文提示 */
type FieldErrors = Partial<Record<string, string>>;

/**
 * 策略创建表单。
 *
 * 返回:
 *   JSX.Element: 含名称、动作、触发条件、启用开关与提交按钮的受控表单。
 */
export default function StrategyForm({
  onCreated,
}: StrategyFormProps): JSX.Element {
  // —— 受控表单字段 ——
  const [name, setName] = useState("");
  const [action, setAction] = useState<StrategyAction>("charge");
  const [comparator, setComparator] = useState<PriceComparator>("greater_than");
  // priceThreshold 以字符串维护，便于保留用户原始输入（含空值），提交时再转数值
  const [priceThreshold, setPriceThreshold] = useState("");
  const [enabled, setEnabled] = useState(true);

  // —— 反馈状态 ——
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 重置全部字段为初始值（创建成功后调用）
  function resetForm(): void {
    setName("");
    setAction("charge");
    setComparator("greater_than");
    setPriceThreshold("");
    setEnabled(true);
  }

  // 提交创建请求
  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault();
    // 清空上一次反馈
    setFieldErrors({});
    setGeneralError(null);
    setSuccessMessage(null);
    setSubmitting(true);

    // 将电价阈值转为数值；空字符串转为 NaN，交由服务端校验拒绝（需求 4.9）
    const parsedThreshold =
      priceThreshold.trim() === "" ? Number.NaN : Number(priceThreshold);

    const input: TradingStrategyInput = {
      name,
      action,
      condition: { comparator, priceThreshold: parsedThreshold },
      enabled,
    };

    const result = await sendJson<TradingStrategy>(
      "/api/trading/strategies",
      "POST",
      input
    );
    setSubmitting(false);

    if (result.ok) {
      // 创建成功：重置表单并通知父级刷新（需求 4.3）
      setSuccessMessage("策略创建成功");
      resetForm();
      onCreated?.();
      return;
    }

    // 校验失败：依据 field 在对应字段下展示错误，保留用户输入（需求 4.8、4.9）
    const { error } = result;
    if (error.field) {
      setFieldErrors({ [error.field]: error.message });
    } else {
      setGeneralError(error.message);
    }
  }

  return (
    <form className="strategy-form" onSubmit={handleSubmit} noValidate>
      <h3 className="strategy-form__title">新建策略</h3>

      {/* 名称（需求 4.8） */}
      <div className="strategy-form__field">
        <label htmlFor="strategy-name">策略名称</label>
        <input
          id="strategy-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={fieldErrors.name ? true : undefined}
        />
        {fieldErrors.name ? (
          <p className="strategy-form__error" role="alert">
            {fieldErrors.name}
          </p>
        ) : null}
      </div>

      {/* 动作（charge/discharge/buy/sell，需求 4.4） */}
      <div className="strategy-form__field">
        <label htmlFor="strategy-action">动作</label>
        <select
          id="strategy-action"
          value={action}
          onChange={(e) => setAction(e.target.value as StrategyAction)}
          aria-invalid={fieldErrors.action ? true : undefined}
        >
          {ACTION_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {formatAction(opt)}
            </option>
          ))}
        </select>
        {fieldErrors.action ? (
          <p className="strategy-form__error" role="alert">
            {fieldErrors.action}
          </p>
        ) : null}
      </div>

      {/* 触发条件：比较关系（5 种，需求 4.5） */}
      <div className="strategy-form__field">
        <label htmlFor="strategy-comparator">比较关系</label>
        <select
          id="strategy-comparator"
          value={comparator}
          onChange={(e) => setComparator(e.target.value as PriceComparator)}
          aria-invalid={fieldErrors.comparator ? true : undefined}
        >
          {COMPARATOR_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {formatComparator(opt)}
            </option>
          ))}
        </select>
        {fieldErrors.comparator ? (
          <p className="strategy-form__error" role="alert">
            {fieldErrors.comparator}
          </p>
        ) : null}
      </div>

      {/* 触发条件：电价阈值（0–999999.99，需求 4.9） */}
      <div className="strategy-form__field">
        <label htmlFor="strategy-threshold">电价阈值</label>
        <input
          id="strategy-threshold"
          type="number"
          step="0.01"
          min="0"
          value={priceThreshold}
          onChange={(e) => setPriceThreshold(e.target.value)}
          aria-invalid={fieldErrors.priceThreshold ? true : undefined}
        />
        {fieldErrors.priceThreshold ? (
          <p className="strategy-form__error" role="alert">
            {fieldErrors.priceThreshold}
          </p>
        ) : null}
        {/* condition 整体缺失时服务端以 field="condition" 返回 */}
        {fieldErrors.condition ? (
          <p className="strategy-form__error" role="alert">
            {fieldErrors.condition}
          </p>
        ) : null}
      </div>

      {/* 启用状态 */}
      <div className="strategy-form__field strategy-form__field--inline">
        <label htmlFor="strategy-enabled">创建后即启用</label>
        <input
          id="strategy-enabled"
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
      </div>

      {/* 通用错误（非字段级） */}
      {generalError ? (
        <p className="strategy-form__error" role="alert">
          {generalError}
        </p>
      ) : null}

      {/* 成功提示 */}
      {successMessage ? (
        <p className="strategy-form__success" role="status">
          {successMessage}
        </p>
      ) : null}

      <button
        type="submit"
        className="strategy-form__submit"
        disabled={submitting}
      >
        {submitting ? "提交中…" : "创建策略"}
      </button>
    </form>
  );
}
