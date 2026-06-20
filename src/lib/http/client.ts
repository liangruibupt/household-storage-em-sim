// 前端 HTTP 客户端封装（需求 1.7、3.6、6.5、6.6）
//
// 本文件提供一个轻量的 `fetch` 封装，供前端各功能区组件（任务 14–18）统一调用。
// 设计要点（设计文档「Web_UI / HTTP 客户端」一节）：
//   - 加载态：请求进行中可显示加载指示（需求 6.5）。
//   - 硬超时：各区域统一 10s 硬超时，使用 AbortController 实现（需求 3.6、6.6）。
//     超时后停止指示、返回结构化错误（type=TIMEOUT），由调用方显示错误与重试入口。
//   - 失败保留：每个数据区维护「上一次成功数据」，失败时不清空（需求 1.7、3.6、6.6）。
//   - 手动重试：错误态提供用户手动重试入口（需求 1.7、3.6、6.6）。
//   - 响应结构：解析后端统一返回的 `{ data }` / `{ error }` 信封，
//     并区分「空数据」（正常状态，需求 1.6、4.2）与「错误」。
//
// 本模块不依赖任何 React Hook，是一个纯客户端工具，可被客户端组件直接 import。
// 失败保留与重试通过一个框架无关的「资源控制器」（createResource）提供，
// 调用方（含 React 客户端组件）可通过订阅其状态变更来驱动 UI。

import type { DataError, DataErrorType, Result } from "../data-access/types";

// ============================================================
// 常量与基础类型
// ============================================================

/** 通用硬超时时间：10 秒（需求 3.6、6.6） */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** HTTP 请求方法 */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

/** 请求选项 */
export interface RequestOptions {
  /** 硬超时毫秒数，缺省为 DEFAULT_TIMEOUT_MS（10s） */
  timeoutMs?: number;
  /** HTTP 方法，缺省为 GET */
  method?: HttpMethod;
  /** 附加请求头 */
  headers?: Record<string, string>;
  /**
   * 请求体（将以 JSON 序列化）。
   * 仅在 method 为 POST/PUT/PATCH/DELETE 等需要携带 body 时使用。
   */
  body?: unknown;
  /**
   * 外部 AbortSignal。当其触发时也会中止请求；
   * 与内部超时信号相互独立，二者任一触发即中止（需求 6.6）。
   */
  signal?: AbortSignal;
}

/**
 * 后端统一返回信封。
 * 成功时携带 `data`（可能为 null / 空数组 / 空对象，均为正常状态）；
 * 失败时携带结构化的 `error`（需求 5.5、5.6）。
 */
interface ResponseEnvelope<T> {
  data?: T;
  error?: DataError;
}

// ============================================================
// 内部辅助：错误构造与状态码映射
// ============================================================

/**
 * 构造结构化错误对象。
 *
 * 参数:
 *   type (DataErrorType): 错误类型标识
 *   message (string): 面向用户的中文提示
 *   field (string | undefined): 校验错误时指明出错字段
 *
 * 返回:
 *   DataError: 结构化错误对象
 */
function makeError(
  type: DataErrorType,
  message: string,
  field?: string
): DataError {
  // 仅在 field 存在时附带该字段，保持错误对象简洁
  return field === undefined ? { type, message } : { type, message, field };
}

/**
 * 将 HTTP 状态码映射为结构化错误类型（需求 5.6 / 设计文档「错误处理决策表」）。
 *
 * 映射关系：
 *   400 → VALIDATION；404 → NOT_FOUND；504 → TIMEOUT；其余非 2xx → PROVIDER_ERROR。
 *
 * 参数:
 *   status (number): HTTP 响应状态码
 *
 * 返回:
 *   DataErrorType: 对应的错误类型标识
 */
function statusToErrorType(status: number): DataErrorType {
  switch (status) {
    case 400:
      return "VALIDATION";
    case 404:
      return "NOT_FOUND";
    case 504:
      return "TIMEOUT";
    default:
      return "PROVIDER_ERROR";
  }
}

/** 各错误类型的默认中文提示（当响应未携带 message 时使用） */
const DEFAULT_ERROR_MESSAGE: Record<DataErrorType, string> = {
  NOT_FOUND: "请求的数据不存在",
  VALIDATION: "输入校验失败",
  PROVIDER_ERROR: "服务暂时不可用，请稍后重试",
  TIMEOUT: "请求超时，请稍后重试",
};

// ============================================================
// 核心：带超时的 JSON 请求
// ============================================================

/**
 * 发起一次 JSON 请求，返回统一的 `Result<T>`，永不抛出异常。
 *
 * 行为约定：
 *   - 使用 AbortController 实现硬超时；超时触发返回 `TIMEOUT` 错误（需求 3.6、6.6）。
 *   - 解析后端 `{ data }` / `{ error }` 信封：
 *       响应携带 `error` → 返回该结构化错误；
 *       响应 OK 且携带 `data` → 返回成功（data 可为 null/空，均视为正常）；
 *   - 非 2xx 且无结构化 error → 按状态码映射错误类型；
 *   - 网络异常 / JSON 解析失败 → 返回 `PROVIDER_ERROR`；
 *   - 外部传入的 abort 信号触发 → 视情况返回 `TIMEOUT`（中止语义）。
 *
 * 参数:
 *   url (string): 请求地址（同源 API 路由，如 "/api/devices"）
 *   options (RequestOptions): 请求选项（方法、超时、请求体等）
 *
 * 返回:
 *   Promise<Result<T>>: 成功 { ok: true, data }，失败 { ok: false, error }
 */
export async function requestJson<T>(
  url: string,
  options: RequestOptions = {}
): Promise<Result<T>> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    method = "GET",
    headers,
    body,
    signal: externalSignal,
  } = options;

  // 内部超时控制器：到时主动中止请求
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // 记录是否由「超时」导致的中止，用于区分超时与外部中止
  let timedOut = false;
  const onTimeout = () => {
    timedOut = true;
  };
  controller.signal.addEventListener("abort", onTimeout, { once: true });

  // 若提供了外部信号，将其中止转发到内部控制器（任一触发即中止）
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  try {
    // 组装请求头：携带 body 时默认使用 JSON Content-Type
    const finalHeaders: Record<string, string> = {
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    };

    const response = await fetch(url, {
      method,
      headers: finalHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    // 解析响应体为信封；空响应体（如 204）按空信封处理
    const envelope = await parseEnvelope<T>(response);

    // 响应显式携带结构化错误时，直接返回（后端已给出 type/message/field）
    if (envelope.error) {
      return { ok: false, error: envelope.error };
    }

    // 非 2xx 且无结构化 error：按状态码映射为结构化错误
    if (!response.ok) {
      const type = statusToErrorType(response.status);
      return {
        ok: false,
        error: makeError(type, DEFAULT_ERROR_MESSAGE[type]),
      };
    }

    // 成功：data 可能为 null / 空数组 / 空对象，均视为正常的空数据（需求 1.6、4.2）
    return { ok: true, data: (envelope.data as T) ?? (null as T) };
  } catch (err) {
    // 区分「超时中止」与「其他异常（网络错误等）」
    if (timedOut || (err instanceof Error && err.name === "AbortError")) {
      return {
        ok: false,
        error: makeError("TIMEOUT", DEFAULT_ERROR_MESSAGE.TIMEOUT),
      };
    }
    // 其余异常（网络中断、DNS 失败、CORS 等）归类为来源错误，不泄漏底层细节
    return {
      ok: false,
      error: makeError("PROVIDER_ERROR", DEFAULT_ERROR_MESSAGE.PROVIDER_ERROR),
    };
  } finally {
    // 清理定时器与事件监听，避免内存泄漏
    clearTimeout(timeoutId);
    controller.signal.removeEventListener("abort", onTimeout);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
  }
}

/**
 * 将 fetch 响应解析为统一信封 `{ data?, error? }`。
 *
 * 容错处理：
 *   - 空响应体（如 204 No Content）返回空信封 `{}`；
 *   - JSON 解析失败时抛出错误，交由上层 catch 转为 PROVIDER_ERROR。
 *
 * 参数:
 *   response (Response): fetch 返回的响应对象
 *
 * 返回:
 *   Promise<ResponseEnvelope<T>>: 解析得到的响应信封
 */
async function parseEnvelope<T>(
  response: Response
): Promise<ResponseEnvelope<T>> {
  // 读取原始文本，便于处理空响应体
  const text = await response.text();
  if (text.length === 0) {
    return {};
  }
  // 解析失败时由上层 catch 捕获并归类为 PROVIDER_ERROR
  return JSON.parse(text) as ResponseEnvelope<T>;
}

// ============================================================
// 便捷方法：GET / 写操作
// ============================================================

/**
 * 发起 GET 请求并返回 `Result<T>`（供任务 14–18 各功能区读取数据使用）。
 *
 * 参数:
 *   url (string): 请求地址
 *   options ({ timeoutMs?, headers?, signal? }): 可选项（超时缺省 10s）
 *
 * 返回:
 *   Promise<Result<T>>: 统一返回类型
 */
export function getJson<T>(
  url: string,
  options: Pick<RequestOptions, "timeoutMs" | "headers" | "signal"> = {}
): Promise<Result<T>> {
  return requestJson<T>(url, { ...options, method: "GET" });
}

/**
 * 发起携带 JSON 请求体的写操作（POST/PUT/PATCH/DELETE），返回 `Result<T>`。
 * 供账户更新（PUT）、策略创建/启停/删除（POST/PUT/DELETE）等场景使用。
 *
 * 参数:
 *   url (string): 请求地址
 *   method (HttpMethod): HTTP 方法
 *   body (unknown): 请求体（将以 JSON 序列化；可省略）
 *   options ({ timeoutMs?, headers?, signal? }): 可选项（超时缺省 10s）
 *
 * 返回:
 *   Promise<Result<T>>: 统一返回类型
 */
export function sendJson<T>(
  url: string,
  method: Exclude<HttpMethod, "GET">,
  body?: unknown,
  options: Pick<RequestOptions, "timeoutMs" | "headers" | "signal"> = {}
): Promise<Result<T>> {
  return requestJson<T>(url, { ...options, method, body });
}

// ============================================================
// 资源控制器：加载态 + 失败保留「上一次成功数据」+ 手动重试
// ============================================================

/**
 * 资源状态快照。供 UI 渲染加载指示、错误提示与数据内容（需求 6.5、6.6）。
 */
export interface ResourceState<T> {
  /** 是否正在加载（需求 6.5） */
  loading: boolean;
  /**
   * 「上一次成功数据」。失败/超时时保留不清空（需求 1.7、3.6、6.6）。
   * 尚无任何成功结果时为 null。
   */
  data: T | null;
  /** 最近一次失败的结构化错误；成功后清空为 null */
  error: DataError | null;
}

/** 状态变更订阅回调 */
export type ResourceListener<T> = (state: ResourceState<T>) => void;

/**
 * 资源控制器：封装一次数据获取的「加载态、失败保留、手动重试」。
 *
 * 该控制器框架无关：不依赖 React。UI 可调用 subscribe 订阅状态变更，
 * 在回调中触发重渲染（React 客户端组件可用 useSyncExternalStore 桥接）。
 */
export interface Resource<T> {
  /** 获取当前状态快照 */
  getState(): ResourceState<T>;
  /**
   * 订阅状态变更；返回取消订阅函数。
   * 订阅时不会立即回调，调用方可先读取 getState()。
   */
  subscribe(listener: ResourceListener<T>): () => void;
  /**
   * 执行加载。成功更新 data 并清空 error；
   * 失败仅设置 error 并保留上一次成功的 data（需求 1.7、3.6、6.6）。
   * 并发调用时仅最后一次结果生效，避免竞态覆盖。
   */
  load(): Promise<ResourceState<T>>;
  /** 手动重试入口：与 load 等价，供错误态的「重试」按钮调用（需求 6.6） */
  retry(): Promise<ResourceState<T>>;
}

/**
 * 创建一个资源控制器。
 *
 * 参数:
 *   fetcher (() => Promise<Result<T>>): 数据获取函数，通常封装一次 getJson/sendJson 调用
 *   initialData (T | null): 初始数据，缺省为 null
 *
 * 返回:
 *   Resource<T>: 资源控制器实例
 */
export function createResource<T>(
  fetcher: () => Promise<Result<T>>,
  initialData: T | null = null
): Resource<T> {
  // 当前状态：初始为非加载、无错误、携带可选初始数据
  let state: ResourceState<T> = {
    loading: false,
    data: initialData,
    error: null,
  };

  // 订阅者集合
  const listeners = new Set<ResourceListener<T>>();

  // 自增请求序号，用于丢弃过期（被后续请求超越）的响应，避免竞态
  let requestSeq = 0;

  /**
   * 更新状态并通知所有订阅者。
   *
   * 参数:
   *   next (Partial<ResourceState<T>>): 待合并的部分状态
   */
  function setState(next: Partial<ResourceState<T>>): void {
    state = { ...state, ...next };
    for (const listener of listeners) {
      listener(state);
    }
  }

  async function load(): Promise<ResourceState<T>> {
    // 记录本次请求序号；进入加载态（保留既有 data，便于失败时继续展示）
    const seq = ++requestSeq;
    setState({ loading: true, error: null });

    const result = await fetcher();

    // 若已有更新的请求发起，则丢弃本次（陈旧）结果
    if (seq !== requestSeq) {
      return state;
    }

    if (result.ok) {
      // 成功：更新数据、清空错误、退出加载态
      setState({ loading: false, data: result.data, error: null });
    } else {
      // 失败/超时：仅记录错误，保留「上一次成功数据」不清空（需求 1.7、3.6、6.6）
      setState({ loading: false, error: result.error });
    }
    return state;
  }

  return {
    getState() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      // 返回取消订阅函数
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    // 手动重试与 load 行为一致（需求 6.6）
    retry: load,
  };
}
