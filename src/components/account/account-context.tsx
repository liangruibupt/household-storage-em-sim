// 账户上下文 AccountContext 与 Provider（任务 21.20，需求 2.1、2.3、6.4、6.6）
//
// 设计文档「Current_Account 选择与传递」与「应用框架与导航」要求：
//   - 共享上下文持有 currentAccountId 与账户列表（≤5），供所有功能页面读取（需求 6.4）。
//   - 账户切换器选择账户后调用 setCurrentAccount(id)，上下文据此更新 currentAccountId，
//     触发设备/能源/交易三大功能区在 3 秒内重新拉取该账户名下数据（需求 6.6）。
//   - 挂载时经 GET /api/accounts 加载账户列表，并默认选定首个账户为 Current_Account（需求 2.1）。
//   - 支持在账户列表刷新（创建/删除后）时同步：当原 Current_Account 已不在列表中，
//     自动选定剩余账户之一，配合账户页删除 Current_Account 后的自动切换（需求 2.3、2.13）。
//
// 架构约束（需求 5.1、5.4）：本组件仅通过 HTTP 客户端访问 /api/accounts，
// 绝不直接 import 数据访问层的 MockProvider 或具体实现。

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getJson } from "@/lib/http/client";
import type { Account, DataError } from "@/lib/data-access/types";

// ============================================================
// 上下文取值类型
// ============================================================

/**
 * 账户上下文对外暴露的取值结构。
 * 三大功能区（设备/能源/交易）页面据 currentAccountId 决定请求作用域，
 * 并以其为依赖键（或 effect 依赖）在切换后重新拉取数据（需求 6.6）。
 */
export interface AccountContextValue {
  /** 全部账户列表（≤5），用于账户列表与导航切换器（需求 2.1、6.4） */
  accounts: Account[];
  /** 当前选中账户（Current_Account）的标识；尚无账户时为 null */
  currentAccountId: string | null;
  /** 账户列表是否正在加载（首次或刷新时为 true，需求 6.7） */
  loading: boolean;
  /** 最近一次加载账户列表的结构化错误；成功后清空为 null */
  error: DataError | null;
  /**
   * 选择 Current_Account（需求 2.3、6.6）。
   * 仅当目标账户存在于当前列表时才更新；切换后各消费页面据 currentAccountId 重新拉取。
   *
   * 参数:
   *   id (string): 目标账户标识
   */
  setCurrentAccount(id: string): void;
  /**
   * 刷新账户列表（创建/删除账户后调用，需求 2.3）。
   * 重新拉取 /api/accounts；若原 Current_Account 已不存在，则自动选定剩余账户之一。
   *
   * 返回:
   *   Promise<void>: 刷新完成时兑现
   */
  refreshAccounts(): Promise<void>;
}

// ============================================================
// 上下文创建与默认值
// ============================================================

/**
 * AccountContext 实例。
 * 默认值仅用于在 Provider 之外被误用时的安全兜底（不会触发真实请求），
 * 正常情况下消费方应位于 <AccountProvider> 之内。
 */
const AccountContext = createContext<AccountContextValue | null>(null);

// ============================================================
// Provider 组件
// ============================================================

/**
 * 账户上下文 Provider。
 *
 * 行为概览：
 *   - 挂载时加载账户列表（GET /api/accounts），默认选定首个账户为 Current_Account（需求 2.1）。
 *   - 暴露 setCurrentAccount 与 refreshAccounts 供导航切换器与账户页消费（需求 2.3、6.6）。
 *   - 刷新后若 Current_Account 已不在列表中，自动回退到剩余账户之一（需求 2.13）。
 *
 * 参数:
 *   children (ReactNode): 被包裹的页面内容（含常驻导航与主内容区）。
 *
 * 返回:
 *   JSX.Element: 提供账户上下文的 Provider。
 */
export function AccountProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  // 账户列表与当前选中账户标识（Current_Account）
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [currentAccountId, setCurrentAccountId] = useState<string | null>(null);

  // 账户列表加载态与加载错误
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<DataError | null>(null);

  // 以 ref 保存最新的 currentAccountId，避免 refreshAccounts 因依赖该值而频繁重建
  const currentIdRef = useRef<string | null>(null);
  currentIdRef.current = currentAccountId;

  /**
   * 加载账户列表并按需调整 Current_Account 选择。
   *
   * 选择规则（需求 2.1、2.13）：
   *   - 列表为空：currentAccountId 置为 null。
   *   - 原 Current_Account 仍在列表中：保持不变。
   *   - 原 Current_Account 不存在（首次加载或其被删除）：选定列表首个账户。
   */
  const loadAccounts = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    const result = await getJson<Account[]>("/api/accounts");
    if (result.ok) {
      // data 可能为 null/空数组，统一规整为数组
      const list = result.data ?? [];
      setAccounts(list);
      // 依据最新列表调整 Current_Account 选择
      const prevId = currentIdRef.current;
      const stillExists =
        prevId !== null && list.some((account) => account.id === prevId);
      if (list.length === 0) {
        // 无账户：清空选择
        setCurrentAccountId(null);
      } else if (!stillExists) {
        // 首次加载或原选中账户已被移除：回退到首个账户（需求 2.1、2.13）
        setCurrentAccountId(list[0].id);
      }
      // 原选中账户仍存在则保持不变（无需更新）
    } else {
      // 加载失败：记录结构化错误，保留既有列表不清空（需求 6.8）
      setError(result.error);
    }
    setLoading(false);
  }, []);

  // 挂载时加载一次账户列表（默认选定首个账户为 Current_Account，需求 2.1）
  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  /**
   * 选择 Current_Account（需求 2.3、6.6）。
   * 仅当目标账户存在于当前列表时才更新，避免选中不存在的账户。
   */
  const setCurrentAccount = useCallback(
    (id: string): void => {
      setAccounts((list) => {
        // 在最新列表中校验目标账户是否存在；存在才切换
        if (list.some((account) => account.id === id)) {
          setCurrentAccountId(id);
        }
        // 不修改列表本身，原样返回
        return list;
      });
    },
    []
  );

  // 暴露给消费方的上下文取值
  const value: AccountContextValue = {
    accounts,
    currentAccountId,
    loading,
    error,
    setCurrentAccount,
    refreshAccounts: loadAccounts,
  };

  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}

// ============================================================
// 消费 Hook
// ============================================================

/**
 * 读取账户上下文的 Hook。
 *
 * 必须在 <AccountProvider> 内使用；否则抛出错误以尽早暴露集成问题。
 *
 * 返回:
 *   AccountContextValue: 账户列表、Current_Account 标识与操作方法。
 */
export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (ctx === null) {
    throw new Error("useAccount 必须在 <AccountProvider> 内使用");
  }
  return ctx;
}
