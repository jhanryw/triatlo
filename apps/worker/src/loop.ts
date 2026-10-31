export interface TickLoopOptions {
  intervalMs: number;
  tick: () => Promise<void>;
  onError: (error: unknown) => void;
  onTickFinished?: () => void;
}

export interface TickLoop {
  start(): void;
  /** Stops scheduling and resolves once an in-flight tick (if any) has finished. */
  stop(): Promise<void>;
}

/**
 * Sequential scheduler: a tick never overlaps with the previous one, and an error in a tick is reported
 * but never stops the loop. Real job claiming (Delivery 4) plugs in as `tick`.
 */
export function createTickLoop(options: TickLoopOptions): TickLoop {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let stopped = true;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(run, options.intervalMs);
  };

  const run = () => {
    timer = null;
    running = options
      .tick()
      .catch(options.onError)
      .finally(() => {
        options.onTickFinished?.();
        running = null;
        schedule();
      });
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      run();
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await running;
    },
  };
}
