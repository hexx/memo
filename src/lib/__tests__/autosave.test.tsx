// @vitest-environment jsdom
//
// オートセーブ（ADR 0013）の共通ロジックの契約:
// - デバウンス・直列化・再送（オンライン復帰 / 次の変更 / 明示的な再試行）
// - 離脱時（hidden / pagehide / アンマウント）の flush
// - cancel / reset
// タイマーは fake timers で進める（ADR 0006 のテスト原則）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  useAutosave,
  type AutosaveControls,
} from "../autosave";

type Value = { v: number };
type SaveFn = (value: Value, context?: { keepalive?: boolean }) => Promise<void>;

function setup(save: SaveFn) {
  return renderHook<
    AutosaveControls<Value>,
    { value: Value; enabled?: boolean }
  >
    (({ value, enabled = true }) =>
      useAutosave(value, save, { delayMs: 1000, enabled }),
    { initialProps: { value: { v: 1 } } });
}

// fake timers を進めつつ、その間に生じた microtask も消化する
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("デバウンス", () => {
  it("変更から 1 秒後に保存する", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = setup(save);

    rerender({ value: { v: 2 } });
    expect(result.current.status).toBe("saving");

    await advance(999);
    expect(save).not.toHaveBeenCalled();

    await advance(1);
    expect(save).toHaveBeenCalledWith({ v: 2 });
    expect(result.current.status).toBe("saved");
  });

  it("初期値のままでは保存しない", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    setup(save);

    await advance(5000);
    expect(save).not.toHaveBeenCalled();
  });

  it("連続した変更は最後の値 1 回にまとめる", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { rerender } = setup(save);

    rerender({ value: { v: 2 } });
    await advance(400);
    rerender({ value: { v: 3 } });
    await advance(400);
    rerender({ value: { v: 4 } });
    await advance(1000);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ v: 4 });
  });

  it("保存中に来た変更は、保存が終わってから 1 つにまとめて再送する", async () => {
    const resolvers: Array<() => void> = [];
    const save = vi.fn<SaveFn>(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        })
    );
    const { rerender } = setup(save);

    rerender({ value: { v: 2 } });
    await advance(1000);
    expect(save).toHaveBeenCalledTimes(1);

    rerender({ value: { v: 3 } });
    rerender({ value: { v: 4 } });
    await advance(1000);
    // 実行中の保存が終わるまで次は送らない（直列化）
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvers[0]!();
    });
    await flushMicrotasks();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0]).toEqual({ v: 4 });
  });
});

describe("失敗と再送", () => {
  it("失敗したら error になり、次の変更で再送する", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(undefined);
    const { result, rerender } = setup(save);

    rerender({ value: { v: 2 } });
    await advance(1000);

    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toBe("network");
    expect(result.current.hasUnsavedChanges()).toBe(true);

    rerender({ value: { v: 3 } });
    await advance(1000);

    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("saved");
    expect(result.current.hasUnsavedChanges()).toBe(false);
  });

  it("retry で直近の失敗を再送する", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(undefined);
    const { result, rerender } = setup(save);

    rerender({ value: { v: 2 } });
    await advance(1000);
    expect(result.current.status).toBe("error");

    act(() => result.current.retry());
    await flushMicrotasks();

    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("saved");
  });

  it("オンライン復帰で未保存分を再送する", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const { result, rerender } = setup(save);

    rerender({ value: { v: 2 } });
    await advance(1000);
    expect(result.current.status).toBe("error");

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("saved");
  });
});

describe("flush", () => {
  it("保留中の変更を待たずに送る", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = setup(save);

    rerender({ value: { v: 2 } });
    let ok = false;
    await act(async () => {
      ok = await result.current.flush();
    });

    expect(ok).toBe(true);
    expect(save).toHaveBeenCalledWith({ v: 2 });
  });

  it("失敗したときは false を返し、未保存のまま保持する", async () => {
    const save = vi.fn().mockRejectedValue(new Error("boom"));
    const { result, rerender } = setup(save);

    rerender({ value: { v: 2 } });
    let ok = true;
    await act(async () => {
      ok = await result.current.flush();
    });

    expect(ok).toBe(false);
    expect(result.current.status).toBe("error");
    expect(result.current.hasUnsavedChanges()).toBe(true);
  });

  it("force なら未変更でも保存する", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = setup(save);

    let ok = false;
    await act(async () => {
      ok = await result.current.flush({ force: true });
    });

    expect(ok).toBe(true);
    expect(save).toHaveBeenCalledWith({ v: 1 });
  });

  it("enabled が false なら自動保存しないが force では保存できる", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = setup(save);

    rerender({ value: { v: 2 }, enabled: false });
    await advance(5000);
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.flush({ force: true });
    });
    expect(save).toHaveBeenCalledWith({ v: 2 });
  });
});

describe("離脱時", () => {
  it("visibilitychange(hidden) で保留分を送る", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { rerender } = setup(save);
    const original = document.visibilityState;

    rerender({ value: { v: 2 } });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(save).toHaveBeenCalledWith({ v: 2 });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => original,
    });
  });

  it("pagehide で keepalive 付きで保留分を送る", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { rerender } = setup(save);

    rerender({ value: { v: 2 } });
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(save).toHaveBeenCalledWith({ v: 2 }, { keepalive: true });
    // pagehide 後に再度発火しても二重送信しない
    save.mockClear();
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("pagehide の保存が失敗したら dirty を残し、後で再送する", async () => {
    const save = vi
      .fn<SaveFn>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const { rerender } = setup(save);

    rerender({ value: { v: 2 } });
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await flushMicrotasks();
    expect(save).toHaveBeenCalledTimes(1);

    // ページが生き残っていれば、オンライン復帰などで再送される
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("アンマウント時に保留分を送る", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { rerender, unmount } = setup(save);

    rerender({ value: { v: 2 } });
    unmount();

    // SPA の画面遷移なので通常の fetch（keepalive はページ破棄時にだけ使う）
    expect(save).toHaveBeenCalledWith({ v: 2 }, undefined);
  });

  it("cancel したらアンマウント時にも送らない", async () => {
    const save = vi.fn<SaveFn>().mockResolvedValue(undefined);
    const { result, rerender, unmount } = setup(save);

    rerender({ value: { v: 2 } });
    await act(async () => {
      await result.current.cancel();
    });
    await advance(5000);
    unmount();

    expect(save).not.toHaveBeenCalled();
  });

  it("cancel は実行中の保存の完了を待つ", async () => {
    const resolvers: Array<() => void> = [];
    const save = vi.fn<SaveFn>(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        })
    );
    const { result, rerender } = setup(save);

    rerender({ value: { v: 2 } });
    await advance(1000);
    expect(save).toHaveBeenCalledTimes(1);

    let cancelled = false;
    const pending = act(async () => {
      await result.current.cancel();
      cancelled = true;
    });
    await flushMicrotasks();
    expect(cancelled).toBe(false);

    await act(async () => {
      resolvers[0]!();
    });
    await pending;
    expect(cancelled).toBe(true);
  });
});

describe("reset", () => {
  it("ベースラインを合わせると保存しない", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = setup(save);

    rerender({ value: { v: 2 } });
    act(() => result.current.reset({ v: 2 }));
    await advance(5000);

    expect(save).not.toHaveBeenCalled();
    expect(result.current.hasUnsavedChanges()).toBe(false);
  });
});
