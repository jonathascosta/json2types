/**
 * The converter page: reads the form, converts in a worker as you type, shows the code, the notes
 * and any parse error, and remembers the options. Everything is written into the page as text.
 */
import { convert, type ConvertRequest, type ConvertResult, type Language } from './convert';
import { SAMPLE } from './sample';
import { loadSettings, saveSettings, type Settings } from './settings';
import type { WorkerRequest, WorkerResponse } from './worker';
import workerUrl from './worker?worker&url';

/** Inputs this large wait a little longer after the last keystroke before converting. */
const LARGE_INPUT = 200_000;

const LANGUAGE_NAMES: Record<Language, string> = { csharp: 'C#', typescript: 'TypeScript' };

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`The page lacks #${id}`);
  return element;
}

/** Runs conversions in a worker, one at a time: while one runs, only the latest request waits. */
class Converter {
  private worker: Worker | null = createWorker();
  private nextId = 0;
  private running: { id: number; request: ConvertRequest } | null = null;
  private waiting: ConvertRequest | null = null;

  constructor(private readonly onResult: (result: ConvertResult) => void) {
    this.worker?.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      this.finish(event.data.id, event.data.result);
    });
    // A worker that fails to load (an old browser, a blocked script) leaves the work to the page.
    this.worker?.addEventListener('error', () => {
      this.worker = null;
      const request = this.waiting ?? this.running?.request;
      this.running = null;
      this.waiting = null;
      if (request) this.request(request);
    });
  }

  request(request: ConvertRequest): void {
    if (!this.worker) {
      this.onResult(convert(request));
      return;
    }
    if (this.running !== null) {
      this.waiting = request;
      return;
    }
    this.running = { id: ++this.nextId, request };
    this.worker.postMessage({ id: this.running.id, request } satisfies WorkerRequest);
  }

  private finish(id: number, result: ConvertResult): void {
    if (id !== this.running?.id) return;
    this.running = null;
    const next = this.waiting;
    this.waiting = null;
    // A newer request makes this result stale: run that one instead of showing this.
    if (next) this.request(next);
    else this.onResult(result);
  }
}

/**
 * The worker, created through a Trusted Types policy: the page's policy only lets scripts load
 * from URLs a named policy vouches for, and this one vouches for the worker's URL alone.
 */
function createWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    const policy = window.trustedTypes?.createPolicy('json2types-worker', {
      createScriptURL(url) {
        if (url !== workerUrl) throw new TypeError(`Not the converter's worker: ${url}`);
        return url;
      },
    });
    const url = policy ? (policy.createScriptURL(workerUrl) as unknown as string) : workerUrl;
    return new Worker(url, { type: 'module' });
  } catch {
    return null;
  }
}

export function startApp(): void {
  const form = byId('tool', HTMLFormElement);
  const input = byId('input', HTMLTextAreaElement);
  const code = byId('code', HTMLElement);
  const output = byId('output', HTMLPreElement);
  const outputLabel = byId('output-label', HTMLHeadingElement);
  const copyButton = byId('copy', HTMLButtonElement);
  const downloadButton = byId('download', HTMLButtonElement);
  const status = byId('status', HTMLParagraphElement);
  const error = byId('error', HTMLDivElement);
  const errorMessage = byId('error-message', HTMLParagraphElement);
  const notes = byId('notes', HTMLElement);
  const notesList = byId('notes-list', HTMLUListElement);
  const csharpOptions = byId('csharp-options', HTMLFieldSetElement);
  const typescriptOptions = byId('typescript-options', HTMLFieldSetElement);
  const fields = form.elements;

  const storage = localStorageOrNull();
  let settings = loadSettings(storage);
  let fileName = 'Root.cs';
  let errorOffset: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const converter = new Converter(show);

  /** The form's values, as settings. */
  function read(): Settings {
    const value = (name: string) => {
      const field = fields.namedItem(name);
      return field instanceof RadioNodeList ||
        field instanceof HTMLInputElement ||
        field instanceof HTMLSelectElement
        ? field.value
        : '';
    };
    const checked = (name: string) => {
      const field = fields.namedItem(name);
      return field instanceof HTMLInputElement && field.checked;
    };
    // Every choice maps to a known value, whatever the form holds.
    return {
      language: value('language') === 'typescript' ? 'typescript' : 'csharp',
      rootName: value('rootName'),
      csharp: {
        kind: value('csharpKind') === 'record' ? 'record' : 'class',
        attributes:
          value('csharpAttributes') === 'newtonsoft'
            ? 'newtonsoft'
            : value('csharpAttributes') === 'none'
              ? 'none'
              : 'systemTextJson',
        nullable: checked('csharpNullable'),
        collection: value('csharpCollection') === 'array' ? 'array' : 'list',
        namespace: value('csharpNamespace'),
      },
      typescript: {
        declaration: value('tsDeclaration') === 'type' ? 'type' : 'interface',
        export: checked('tsExport'),
        readonly: checked('tsReadonly'),
      },
      rememberInput: checked('rememberInput'),
      input: input.value,
    };
  }

  /** Puts settings into the form. */
  function write(s: Settings): void {
    const set = (name: string, value: string) => {
      const field = fields.namedItem(name);
      if (
        field instanceof RadioNodeList ||
        field instanceof HTMLInputElement ||
        field instanceof HTMLSelectElement
      )
        field.value = value;
    };
    const check = (name: string, on: boolean) => {
      const field = fields.namedItem(name);
      if (field instanceof HTMLInputElement) field.checked = on;
    };
    set('language', s.language);
    set('rootName', s.rootName);
    set('csharpKind', s.csharp.kind);
    set('csharpAttributes', s.csharp.attributes);
    check('csharpNullable', s.csharp.nullable);
    set('csharpCollection', s.csharp.collection);
    set('csharpNamespace', s.csharp.namespace);
    set('tsDeclaration', s.typescript.declaration);
    check('tsExport', s.typescript.export);
    check('tsReadonly', s.typescript.readonly);
    check('rememberInput', s.rememberInput);
    input.value = s.input;
  }

  function showLanguage(language: Language): void {
    csharpOptions.hidden = language !== 'csharp';
    typescriptOptions.hidden = language !== 'typescript';
    outputLabel.textContent = LANGUAGE_NAMES[language];
  }

  function run(): void {
    clearTimeout(timer);
    settings = read();
    showLanguage(settings.language);
    if (input.value.length > LARGE_INPUT) status.textContent = 'Converting…';
    converter.request({
      json: settings.input,
      language: settings.language,
      rootName: settings.rootName,
      csharp: settings.csharp,
      typescript: settings.typescript,
    });
  }

  function show(result: ConvertResult): void {
    if (!result.ok) {
      // Keep the last code, marked as out of date, so a typo doesn't blank the output.
      const empty = input.value.trim() === '';
      if (empty) code.textContent = '';
      output.classList.toggle('stale', !empty && code.textContent !== '');
      copyButton.disabled = downloadButton.disabled = code.textContent === '';
      error.hidden = empty;
      errorMessage.textContent = result.message;
      errorOffset = result.offset;
      notes.hidden = true;
      status.textContent = empty ? '' : 'The JSON has an error.';
      return;
    }
    code.textContent = result.code;
    fileName = result.fileName;
    output.classList.remove('stale');
    copyButton.disabled = downloadButton.disabled = false;
    error.hidden = true;
    errorMessage.textContent = '';
    errorOffset = null;
    notesList.replaceChildren(
      ...result.diagnostics.map((d) => {
        const item = document.createElement('li');
        item.className = d.severity;
        const where = document.createElement('code');
        where.textContent = d.path;
        const times = d.count > 1 ? ` (${String(d.count)}×)` : '';
        item.append(`${d.severity === 'warning' ? 'Warning' : 'Note'} at `, where, `: ${d.message}${times}`);
        return item;
      }),
    );
    notes.hidden = result.diagnostics.length === 0;
    const types = result.typeCount === 1 ? '1 type' : `${String(result.typeCount)} types`;
    status.textContent = `${types} in ${LANGUAGE_NAMES[settings.language]}.`;
  }

  function remember(): void {
    saveSettings(storage, read());
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
  });
  form.addEventListener('change', (event) => {
    if (event.target === input) return;
    run();
    remember();
  });
  // Text fields convert as you type; the JSON waits for a pause, longer when it's large.
  form.addEventListener('input', (event) => {
    clearTimeout(timer);
    const delay = event.target === input ? (input.value.length > LARGE_INPUT ? 400 : 150) : 150;
    timer = setTimeout(() => {
      run();
      remember();
    }, delay);
  });

  byId('sample', HTMLButtonElement).addEventListener('click', () => {
    input.value = SAMPLE;
    run();
    remember();
    input.focus();
  });
  byId('clear', HTMLButtonElement).addEventListener('click', () => {
    input.value = '';
    run();
    remember();
    input.focus();
  });
  byId('show-error', HTMLButtonElement).addEventListener('click', () => {
    if (errorOffset === null) return;
    input.focus();
    input.setSelectionRange(errorOffset, Math.min(errorOffset + 1, input.value.length));
  });
  copyButton.addEventListener('click', () => {
    navigator.clipboard.writeText(code.textContent).then(
      () => (status.textContent = 'Copied to the clipboard.'),
      () => {
        // Without clipboard access, select the code so a keyboard shortcut can copy it.
        getSelection()?.selectAllChildren(code);
        output.focus();
        status.textContent = 'Selected: press Ctrl+C (⌘C on a Mac) to copy.';
      },
    );
  });
  downloadButton.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([code.textContent], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
    status.textContent = `Downloaded ${fileName}.`;
  });

  write(settings);
  run();
}

/** localStorage, or null where it's blocked (some private modes throw on access). */
function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
