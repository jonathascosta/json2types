/**
 * The converter page: reads the form, converts in a worker as you type, shows the code, the notes
 * and any parse error, and remembers the options. Everything is written into the page as text.
 */
import workerSource from 'virtual:converter-worker';
import type { Diagnostic } from '../infer';
import type { ConvertRequest, ConvertResult, Language } from './convert';
import { Converter, type WorkerLike } from './converter';
import { SAMPLE } from './sample';
import { loadSettings, saveInput, saveSettings, settingsFromForm, type Settings } from './settings';

/** Inputs this large wait a little longer after the last keystroke before converting. */
const LARGE_INPUT = 200_000;

const LANGUAGE_NAMES: Record<Language, string> = { csharp: 'C#', typescript: 'TypeScript' };

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`The page lacks #${id}`);
  return element;
}

let workerUrl: string | undefined;
let workerPolicy: { createScriptURL(url: string): TrustedScriptURL } | null | undefined;

/**
 * A worker running the converter from a blob: URL, so it inherits the page's Content Security
 * Policy (scripts/worker-source.mjs). It's created through a Trusted Types policy: the page's
 * policy only lets scripts load from URLs a named policy vouches for, and this one vouches for
 * that one blob: URL alone. The URL and the policy are made once and reused for every worker.
 */
function createWorker(): WorkerLike | null {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined') return null;
  try {
    const url = (workerUrl ??= URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' })));
    workerPolicy ??=
      window.trustedTypes?.createPolicy('json2types-worker', {
        createScriptURL(candidate) {
          if (candidate !== url) throw new TypeError(`Not the converter's worker: ${candidate}`);
          return candidate;
        },
      }) ?? null;
    // TypeScript's DOM types don't know Worker takes a TrustedScriptURL yet.
    const scriptUrl = workerPolicy ? (workerPolicy.createScriptURL(url) as unknown as string) : url;
    return new Worker(scriptUrl);
  } catch {
    return null;
  }
}

/** localStorage, or null where it's blocked (some private modes throw on access). */
function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** A text field: these convert after a pause in typing rather than on every change. */
function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && target.type === 'text')
  );
}

/** A note as a list item, its path as code. */
function note(diagnostic: Diagnostic): HTMLLIElement {
  const item = document.createElement('li');
  item.className = diagnostic.severity;
  // The line counting the notes not shown has no place and no count of its own.
  if (diagnostic.summary) {
    item.textContent = diagnostic.message;
    return item;
  }
  const where = document.createElement('code');
  where.textContent = diagnostic.path;
  const times = diagnostic.count > 1 ? ` (${String(diagnostic.count)}×)` : '';
  const kind = diagnostic.severity === 'warning' ? 'Warning' : 'Note';
  item.append(`${kind} at `, where, `: ${diagnostic.message}${times}`);
  return item;
}

/** Starts the converter, if this page has one. */
export function startApp(): void {
  const form = document.getElementById('tool');
  if (!(form instanceof HTMLFormElement)) return;
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
  const rememberNote = byId('remember-note', HTMLParagraphElement);
  // A language's own page has only that language's options.
  const csharpOptions = document.getElementById('csharp-options');
  const typescriptOptions = document.getElementById('typescript-options');
  const fields = form.elements;

  const storage = localStorageOrNull();
  /** What the code on show was made from; it stays on show while the JSON has an error. */
  let shown: { fileName: string; language: Language } | null = null;
  let errorOffset: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The JSON as last saved, so an unchanged one isn't written again. */
  let savedInput: string | null = null;

  /** The settings as last read or loaded, for the fields this page doesn't have. */
  let known = loadSettings(storage);

  const converter = new Converter(show, createWorker);

  /** The form's values, through the same checks as stored settings; fields the page lacks keep theirs. */
  function read(): Settings {
    known = settingsFromForm(
      known,
      (name) => {
        const field = fields.namedItem(name);
        if (field instanceof HTMLInputElement && field.type === 'checkbox') return field.checked;
        if (
          field instanceof RadioNodeList ||
          field instanceof HTMLInputElement ||
          field instanceof HTMLSelectElement
        )
          return field.value;
        return null;
      },
      input.value,
    );
    return known;
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
    // On a language's own page the language is the page's, not the one remembered.
    if (fields.namedItem('language') instanceof RadioNodeList) set('language', s.language);
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
    savedInput = s.rememberInput ? s.input : null;
  }

  /** Writes to the live region only when the text changes, so it isn't read out on every key. */
  function say(text: string): void {
    if (status.textContent !== text) status.textContent = text;
  }

  function run(): void {
    clearTimeout(timer);
    const settings = read();
    if (csharpOptions) csharpOptions.hidden = settings.language !== 'csharp';
    if (typescriptOptions) typescriptOptions.hidden = settings.language !== 'typescript';
    if (input.value.length > LARGE_INPUT) say('Converting…');
    converter.request({
      json: settings.input,
      language: settings.language,
      rootName: settings.rootName,
      csharp: settings.csharp,
      typescript: settings.typescript,
    });
  }

  /** Shows a result as of the request it answers: the form may have changed since. */
  function show(result: ConvertResult, request: ConvertRequest): void {
    const empty = request.json.trim() === '';
    if (result.ok) {
      code.textContent = result.code;
      shown = { fileName: result.fileName, language: request.language };
    } else if (empty) {
      code.textContent = '';
      shown = null;
    }
    // On an error the last code stays, marked out of date, so a typo doesn't blank the output; it
    // can't be copied or downloaded, being code for a JSON that is no longer there.
    const stale = !result.ok && shown !== null;
    output.classList.toggle('stale', stale);
    const language = LANGUAGE_NAMES[shown?.language ?? request.language];
    outputLabel.textContent = stale ? `${language} code (out of date)` : `${language} code`;
    copyButton.disabled = downloadButton.disabled = shown === null || stale;

    const invalid = !result.ok && !empty;
    error.hidden = !invalid;
    errorMessage.textContent = invalid ? result.message : '';
    errorOffset = invalid ? result.offset : null;
    input.setAttribute('aria-invalid', String(invalid));

    if (!result.ok) {
      notes.hidden = true;
      // Only that there is an error: the message itself, which changes as you type, is in the error
      // box, which describes the JSON field.
      say(invalid ? 'The JSON has an error.' : '');
      return;
    }
    notesList.replaceChildren(...result.diagnostics.map(note));
    notes.hidden = result.diagnostics.length === 0;
    const name = LANGUAGE_NAMES[request.language];
    say(
      result.typeCount === 0
        ? `No types to declare: the ${name} code says how to read this JSON.`
        : `${result.typeCount === 1 ? '1 type' : `${String(result.typeCount)} types`} in ${name}.`,
    );
  }

  /** Saves the options, and the JSON when it's to be remembered and has changed. */
  function remember(): void {
    const settings = read();
    saveSettings(storage, settings);
    // Nothing to do when the JSON kept is this one, or when none is kept nor to be kept.
    const unchanged = settings.rememberInput
      ? settings.input === savedInput
      : savedInput === null && rememberNote.hidden;
    if (unchanged) return;
    // The note stays by the checkbox, which it describes, until the JSON fits or isn't kept.
    const saved = saveInput(storage, settings);
    savedInput = saved && settings.rememberInput ? settings.input : null;
    rememberNote.hidden = saved;
    rememberNote.textContent = saved ? '' : 'This JSON is too large to remember in this browser.';
  }

  /** Replaces the JSON as an edit, so Ctrl+Z brings back what was there. */
  function replaceInput(text: string): void {
    input.focus();
    input.select();
    // execCommand is the only way to change a text field that keeps the change in its undo history.
    const edited =
      text === ''
        ? // eslint-disable-next-line @typescript-eslint/no-deprecated
          document.execCommand('delete')
        : // eslint-disable-next-line @typescript-eslint/no-deprecated
          document.execCommand('insertText', false, text);
    if (!edited || input.value !== text) input.setRangeText(text, 0, input.value.length, 'end');
    run();
    remember();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
  });
  form.addEventListener('change', (event) => {
    // Text fields convert as they're typed in (below); the remember box changes no code.
    if (isTextField(event.target)) return;
    if (!(event.target instanceof HTMLInputElement && event.target.name === 'rememberInput')) run();
    remember();
  });
  form.addEventListener('input', (event) => {
    if (!isTextField(event.target)) return;
    clearTimeout(timer);
    const delay = event.target === input && input.value.length > LARGE_INPUT ? 400 : 150;
    timer = setTimeout(() => {
      run();
      remember();
    }, delay);
  });

  byId('sample', HTMLButtonElement).addEventListener('click', () => {
    replaceInput(SAMPLE);
  });
  byId('clear', HTMLButtonElement).addEventListener('click', () => {
    replaceInput('');
  });
  byId('show-error', HTMLButtonElement).addEventListener('click', () => {
    if (errorOffset === null) return;
    input.focus();
    input.setSelectionRange(errorOffset, Math.min(errorOffset + 1, input.value.length));
  });
  copyButton.addEventListener('click', () => {
    // navigator.clipboard is missing outside secure contexts, whatever its type says.
    const clipboard = navigator.clipboard as Clipboard | undefined;
    const copied = clipboard
      ? clipboard.writeText(code.textContent)
      : Promise.reject(new Error('No clipboard'));
    copied.then(
      () => {
        say('Copied to the clipboard.');
      },
      () => {
        // Without clipboard access, select the code so a keyboard shortcut can copy it.
        getSelection()?.selectAllChildren(code);
        output.focus();
        say('Selected: press Ctrl+C (⌘C on a Mac) to copy.');
      },
    );
  });
  downloadButton.addEventListener('click', () => {
    if (!shown) return;
    const { fileName } = shown;
    const url = URL.createObjectURL(new Blob([code.textContent], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
    say(`Downloaded ${fileName}.`);
  });

  write(known);
  run();
}
