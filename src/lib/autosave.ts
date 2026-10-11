import { useCallback, useEffect, useRef, useState } from "react";
import type { SaveContext } from "./api";

/**
 * オートセーブ（ADR 0013）の共通ロジック。
 *
 * - 変更を検知して `delayMs` 後に保存する（デバウンス）
 * - 保存は直列化し、保存中に来た変更はまとめて 1 回だけ再送する
 * - 失敗したら未保存のまま保持し、① オンライン復帰、② 次の変更、③ 明示的な
 *   再試行で再送する
 * - 離脱時（hidden / pagehide / アンマウント）は保留分を投げっぱなしで送る
 */
export type AutosaveStatus = "saved" | "saving" | "error";

/** 保存時に渡す文脈。ページ離脱時のみ keepalive を使う（64KiB のボディ上限がある） */
export type { SaveContext };

/** 保存の実行方法。force: 変更が無くても保存する / allowDisabled: 自動保存の対象外でも保存する */
export interface SaveRequest {
  force?: boolean;
  allowDisabled?: boolean;
}

export interface AutosaveControls<T> {
  status: AutosaveStatus;
  error: Error | null;
  /** 未保存の変更が残っているか（デバウンス待ち・送信中・失敗を含む） */
  hasUnsavedChanges: () => boolean;
  /** 保留中の保存を今すぐ実行して完了を待つ */
  flush: (options?: SaveRequest) => Promise<boolean>;
  /** 直近の失敗を再送する */
  retry: () => void;
  /** 保留中の保存を捨て、実行中の保存の完了を待つ（破棄・削除時） */
  cancel: () => Promise<void>;
  /** ベースラインを指定の内容に合わせる（別メモへの切り替え時） */
  reset: (value: T) => void;
}

export interface UseAutosaveOptions {
  /** 変更を検知してから保存するまでの待ち時間 */
  delayMs?: number;
  /** false の間は自動保存しない（明示的な flush では保存できる） */
  enabled?: boolean;
}

const toKey = (value: unknown): string => JSON.stringify(value);

// keepalive リクエストのボディ上限（バイト）。超えるメモは keepalive を使わない
// （離脱時の最後の flush は非保証。ADR 0013 を参照）
const KEEPALIVE_BODY_LIMIT_BYTES = 64 * 1024;

export function useAutosave<T>(
  value: T,
  save: (value: T, context?: SaveContext) => Promise<void>,
  { delayMs = 1000, enabled = true }: UseAutosaveOptions = {}
): AutosaveControls<T> {
  const [status, setStatus] = useState<AutosaveStatus>("saved");
  const [error, setError] = useState<Error | null>(null);

  const key = toKey(value);
  const valueRef = useRef(value);
  valueRef.current = value;
  const keyRef = useRef(key);
  keyRef.current = key;
  const saveRef = useRef(save);
  saveRef.current = save;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const baselineRef = useRef(key);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef<Promise<unknown> | null>(null);
  // 予約済み（キュー待ち or 実行中）の保存数。離脱時の投げっぱなし送信と競合させない
  const pendingRef = useRef(0);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const discardRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 実行中の保存の完了を待つ。解決済みの Promise が残っていても無限ループしない
  const waitForRunning = useCallback(async () => {
    while (runningRef.current) {
      const running = runningRef.current;
      await running;
      if (runningRef.current === running) runningRef.current = null;
    }
  }, []);

  const saveNow = useCallback(
    (request: SaveRequest = {}): Promise<boolean> => {
      pendingRef.current += 1;
      const task = async (): Promise<boolean> => {
        try {
          // 実行中の投げっぱなし送信（離脱時）を待つ
          await waitForRunning();
          // 待っている間に破棄・削除された場合は送らない
          if (discardRef.current) return false;
          const { force = false, allowDisabled = false } = request;
          // 自動保存の対象外（新規で内容が入っていない等）なら何もしない
          if (!allowDisabled && !enabledRef.current) return true;
          if (!force && keyRef.current === baselineRef.current) return true;
          const targetKey = keyRef.current;
          const target = valueRef.current;
          setStatus("saving");
          setError(null);
          const promise = (async () => {
            try {
              await saveRef.current(target);
              baselineRef.current = targetKey;
              return true;
            } catch (err) {
              setError(err instanceof Error ? err : new Error(String(err)));
              return false;
            }
          })();
          runningRef.current = promise;
          let ok: boolean;
          try {
            ok = await promise;
          } finally {
            runningRef.current = null;
          }
          if (ok) {
            setStatus(keyRef.current === baselineRef.current ? "saved" : "saving");
          } else {
            setStatus("error");
          }
          return ok;
        } finally {
          pendingRef.current -= 1;
        }
      };
      // 保存の開始をキューで直列化する（同じタイミングの複数呼び出しで二重送信しない）
      const next = queueRef.current.then(task, task);
      queueRef.current = next.then(
        () => undefined,
        () => undefined
      );
      return next;
    },
    [waitForRunning]
  );

  // 直列化の輪の外から投げっぱなしで送る（離脱時）。成功したときだけベースラインを進め、
  // 失敗しても dirty を残す（ページが生き残っていれば次の契機で再送できる）
  const sendInBackground = useCallback(
    (value: T, context?: SaveContext): Promise<void> => {
      const sentKey = toKey(value);
      const promise = saveRef.current(value, context)
        .then(() => {
          baselineRef.current = sentKey;
        })
        .catch(() => {});
      // 直列化の輪に載せて、あとから flush されたときに待てるようにする
      runningRef.current = promise;
      void promise.then(() => {
        if (runningRef.current === promise) runningRef.current = null;
      });
      return promise;
    },
    []
  );

  const flush = useCallback(
    async (options?: SaveRequest): Promise<boolean> => {
      clearTimer();
      const ok = await saveNow(options);
      if (!ok) return false;
      // 保存中に変更されていたら、その分も保存してから戻る
      if (keyRef.current !== baselineRef.current) return saveNow();
      return true;
    },
    [clearTimer, saveNow]
  );

  const retry = useCallback(() => {
    void flush();
  }, [flush]);

  const cancel = useCallback(async () => {
    discardRef.current = true;
    clearTimer();
    // 実行中の保存が終わるまで待つ（削除との順序を確定させる）
    await waitForRunning();
  }, [clearTimer, waitForRunning]);

  const reset = useCallback(
    (next: T) => {
      discardRef.current = false;
      baselineRef.current = toKey(next);
      clearTimer();
      setStatus("saved");
      setError(null);
    },
    [clearTimer]
  );

  // 変更を検知したらデバウンスして保存する
  useEffect(() => {
    if (!enabled || discardRef.current || key === baselineRef.current) return;
    setStatus("saving");
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void saveNow();
    }, delayMs);
    return clearTimer;
  }, [key, enabled, delayMs, saveNow, clearTimer]);

  // オンライン復帰で未保存分を再送する
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOnline = () => {
      if (discardRef.current) return;
      if (keyRef.current !== baselineRef.current) void saveNow();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [saveNow]);

  // 離脱時に保留分を送る。タブを閉じる/破棄される可能性があるときは keepalive を使う
  useEffect(() => {
    if (typeof window === "undefined") return;
    const pending = () =>
      !discardRef.current &&
      enabledRef.current &&
      keyRef.current !== baselineRef.current;

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        if (pending()) void flush();
      }
    };
    const onPageHide = (event: PageTransitionEvent) => {
      // bfcache に入るだけならページは生きているので、保留分はそのまま残す
      if (event.persisted || !pending()) return;
      // 予約済み・実行中の保存があれば二重送信しない（新規作成で重複レコードを作らないため）
      if (runningRef.current || pendingRef.current > 0) return;
      const value = valueRef.current;
      // keepalive はボディ 64KiB までしか送れないため、大きいメモは通常の fetch にする
      const tooLarge =
        new Blob([keyRef.current]).size > KEEPALIVE_BODY_LIMIT_BYTES;
      void sendInBackground(value, tooLarge ? undefined : { keepalive: true });
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [flush, sendInBackground]);

  // SPA の画面遷移でも、保留分を投げっぱなしで送る（ページは生きているので通常の fetch）。
  // すでに実行中の保存があれば二重送信しない
  useEffect(
    () => () => {
      if (discardRef.current || !enabledRef.current) return;
      if (keyRef.current === baselineRef.current) return;
      if (runningRef.current || pendingRef.current > 0) return;
      void sendInBackground(valueRef.current);
    },
    [sendInBackground]
  );

  const hasUnsavedChanges = useCallback(
    () => keyRef.current !== baselineRef.current,
    []
  );

  return { status, error, hasUnsavedChanges, flush, retry, cancel, reset };
}
