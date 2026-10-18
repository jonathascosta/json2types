import { describe, expect, it } from 'vitest';
import { convert, type ConvertRequest, type ConvertResult } from './convert';
import { Converter, RESTART_AFTER_MS, type WorkerLike } from './converter';
import { DEFAULT_SETTINGS } from './settings';
import type { WorkerRequest, WorkerResponse } from './worker';

const request = (json: string): ConvertRequest => ({
  json,
  language: 'csharp',
  rootName: 'Root',
  csharp: DEFAULT_SETTINGS.csharp,
  typescript: DEFAULT_SETTINGS.typescript,
});

/** A worker that answers only when told to, so the tests decide the order of everything. */
class FakeWorker implements WorkerLike {
  readonly sent: WorkerRequest[] = [];
  terminated = false;
  private readonly listeners = new Map<string, ((event: never) => void)[]>();

  postMessage(message: WorkerRequest): void {
    this.sent.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  addEventListener(type: string, listener: (event: never) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  /** Answers a request it was sent (the oldest unanswered one by default). */
  answer(message: WorkerRequest | undefined = this.sent[0]): void {
    if (!message) throw new Error('Nothing to answer');
    const response: WorkerResponse = { id: message.id, result: convert(message.request) };
    this.emit('message', { data: response });
  }
  crash(): void {
    this.emit('error', { preventDefault: () => undefined });
  }
  private emit(type: string, event: object): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event as never);
  }
}

function setUp(workers: (FakeWorker | null)[]) {
  const shown: { json: string; result: ConvertResult }[] = [];
  const created: (FakeWorker | null)[] = [];
  let time = 0;
  const converter = new Converter(
    (result, req) => shown.push({ json: req.json, result }),
    () => {
      const worker = workers.shift() ?? null;
      created.push(worker);
      return worker;
    },
    () => time,
  );
  return {
    converter,
    shown,
    created,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe('Converter', () => {
  it('converts in the worker and shows the result with its request', () => {
    const worker = new FakeWorker();
    const { converter, shown } = setUp([worker]);
    converter.request(request('{"a": 1}'));
    expect(shown).toEqual([]);
    worker.answer();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ json: '{"a": 1}', result: { ok: true } });
  });

  it('runs one at a time and only the latest waiting request, never showing a stale result', () => {
    const worker = new FakeWorker();
    const { converter, shown } = setUp([worker]);
    converter.request(request('1'));
    converter.request(request('2'));
    converter.request(request('3'));
    expect(worker.sent.map((m) => m.request.json)).toEqual(['1']);
    worker.answer(worker.sent[0]);
    // The answer to 1 is stale: 3 is sent instead, and 2 never is.
    expect(shown).toEqual([]);
    expect(worker.sent.map((m) => m.request.json)).toEqual(['1', '3']);
    worker.answer(worker.sent[1]);
    expect(shown.map((s) => s.json)).toEqual(['3']);
  });

  it('ignores answers to requests it is no longer waiting for', () => {
    const worker = new FakeWorker();
    const { converter, shown } = setUp([worker]);
    converter.request(request('1'));
    worker.answer(worker.sent[0]);
    worker.answer(worker.sent[0]);
    expect(shown).toHaveLength(1);
  });

  it('abandons a slow conversion for a newer request, in a new worker', () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const { converter, shown, advance } = setUp([first, second]);
    converter.request(request('slow'));
    advance(RESTART_AFTER_MS);
    converter.request(request('new'));
    expect(first.terminated).toBe(true);
    expect(second.sent.map((m) => m.request.json)).toEqual(['new']);
    first.answer();
    expect(shown).toEqual([]);
    second.answer();
    expect(shown.map((s) => s.json)).toEqual(['new']);
  });

  it('drops an older waiting request when it abandons a slow conversion', () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const { converter, shown, advance } = setUp([first, second]);
    converter.request(request('A'));
    advance(100);
    converter.request(request('B'));
    advance(RESTART_AFTER_MS);
    converter.request(request('C'));
    second.answer();
    expect(second.sent.map((m) => m.request.json)).toEqual(['C']);
    expect(shown.map((s) => s.json)).toEqual(['C']);
  });

  it('keeps waiting while a conversion is younger than the restart threshold', () => {
    const worker = new FakeWorker();
    const { converter, advance } = setUp([worker]);
    converter.request(request('A'));
    advance(RESTART_AFTER_MS - 1);
    converter.request(request('B'));
    expect(worker.terminated).toBe(false);
    expect(worker.sent.map((m) => m.request.json)).toEqual(['A']);
  });

  it('never runs a request that crashed a worker on the page, even in a new worker', () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const third = new FakeWorker();
    const { converter, shown } = setUp([first, second, third]);
    converter.request(request('[1]'));
    first.answer();
    converter.request(request('[2]'));
    first.crash();
    converter.request(request('[3]'));
    second.crash();
    expect(shown.map((s) => [s.json, s.result.ok])).toEqual([
      ['[1]', true],
      ['[2]', false],
      ['[3]', false],
    ]);
    converter.request(request('[4]'));
    expect(third.sent.map((m) => m.request.json)).toEqual(['[4]']);
  });

  it('converts on the page when there is no worker', () => {
    const { converter, shown } = setUp([null]);
    converter.request(request('[1]'));
    expect(shown).toHaveLength(1);
    expect(shown[0]?.result).toMatchObject({ ok: true });
  });

  it('converts on the page when the worker fails to load', () => {
    const worker = new FakeWorker();
    const { converter, shown } = setUp([worker]);
    converter.request(request('[1]'));
    worker.crash();
    expect(worker.terminated).toBe(true);
    expect(shown.map((s) => s.json)).toEqual(['[1]']);
    converter.request(request('[2]'));
    expect(shown.map((s) => s.json)).toEqual(['[1]', '[2]']);
  });

  it('reports a crash on a request, and goes on in a new worker', () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const { converter, shown } = setUp([first, second]);
    converter.request(request('[1]'));
    first.answer();
    converter.request(request('[2]'));
    first.crash();
    expect(first.terminated).toBe(true);
    expect(shown[1]).toEqual({
      json: '[2]',
      result: { ok: false, message: 'Something went wrong converting this JSON.', offset: null },
    });
    converter.request(request('[3]'));
    second.answer();
    expect(shown.map((s) => s.json)).toEqual(['[1]', '[2]', '[3]']);
  });
});
