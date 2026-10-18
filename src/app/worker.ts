/** Converts off the page's thread, so a large paste never freezes typing or scrolling. */
import { convertSafely, type ConvertRequest, type ConvertResult } from './convert';

export interface WorkerRequest {
  readonly id: number;
  readonly request: ConvertRequest;
}

export interface WorkerResponse {
  readonly id: number;
  readonly result: ConvertResult;
}

// The project's types are the page's (DOM), not a worker's; these are the two members used here.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
};

scope.onmessage = (event) => {
  const { id, request } = event.data;
  scope.postMessage({ id, result: convertSafely(request) });
};
