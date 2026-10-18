/**
 * Runs conversions in a worker, one at a time: while one runs, only the latest request waits, and
 * one that has run too long is abandoned for the newer one. Without a worker, or if it won't load,
 * the page converts by itself.
 */
import { convertSafely, type ConvertRequest, type ConvertResult } from './convert';
import type { WorkerRequest, WorkerResponse } from './worker';

/** The part of a Worker this uses, so tests can stand in for one. */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  terminate(): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerResponse>) => void): void;
  addEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void;
}

/** A conversion running longer than this is stopped when a newer one comes in. */
export const RESTART_AFTER_MS = 300;

const CRASHED: ConvertResult = {
  ok: false,
  message: 'Something went wrong converting this JSON.',
  offset: null,
};

export class Converter {
  private worker: WorkerLike | null;
  /** Whether the worker has answered once, so its errors are crashes, not a failure to load. */
  private loaded = false;
  private nextId = 0;
  private running: { id: number; request: ConvertRequest; since: number } | null = null;
  private waiting: ConvertRequest | null = null;

  constructor(
    private readonly onResult: (result: ConvertResult, request: ConvertRequest) => void,
    private readonly createWorker: () => WorkerLike | null,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.worker = this.start();
  }

  request(request: ConvertRequest): void {
    if (!this.worker) {
      this.onResult(convertSafely(request), request);
      return;
    }
    if (this.running) {
      if (this.now() - this.running.since < RESTART_AFTER_MS) {
        this.waiting = request;
        return;
      }
      // Too slow to wait for: drop it with its worker and start afresh.
      this.worker.terminate();
      this.running = null;
      this.worker = this.start();
      if (!this.worker) {
        this.request(request);
        return;
      }
    }
    this.post(request);
  }

  private post(request: ConvertRequest): void {
    this.running = { id: ++this.nextId, request, since: this.now() };
    this.worker?.postMessage({ id: this.running.id, request });
  }

  private start(): WorkerLike | null {
    const worker = this.createWorker();
    if (!worker) return null;
    this.loaded = false;
    worker.addEventListener('message', (event) => {
      if (worker !== this.worker) return;
      this.loaded = true;
      this.finish(event.data.id, event.data.result);
    });
    const fail = () => {
      if (worker === this.worker) this.failed();
    };
    worker.addEventListener('error', (event) => {
      event.preventDefault();
      fail();
    });
    worker.addEventListener('messageerror', fail);
    return worker;
  }

  private finish(id: number, result: ConvertResult): void {
    if (!this.running || id !== this.running.id) return;
    const { request } = this.running;
    this.running = null;
    const next = this.waiting;
    this.waiting = null;
    // A newer request makes this result stale: run that one instead of showing this.
    if (next) this.post(next);
    else this.onResult(result, request);
  }

  /**
   * A worker that never answered couldn't load (an old browser, a blocked script): the page takes
   * over. One that has answered before crashed on this request: report it, and use a new worker.
   */
  private failed(): void {
    const running = this.running;
    const next = this.waiting;
    this.running = null;
    this.waiting = null;
    this.worker?.terminate();
    if (this.loaded) {
      this.worker = this.start();
      if (next) this.request(next);
      else if (running) this.onResult(CRASHED, running.request);
      return;
    }
    this.worker = null;
    const request = next ?? running?.request;
    if (request) this.request(request);
  }
}
