/**
 * Built-ins/keywords/stdlib pra linguagens sem LSP completo.
 *
 * Por que existe:
 *   - Monaco standalone só tem TS Server embedded — outras linguagens (Python,
 *     Go, Rust) ficam só com syntax highlighting + word-based completion.
 *   - VS Code para essas linguagens usa LSP externo (Pyright, gopls, rust-analyzer)
 *     que UNDRCOD não tem yet. Aqui injetamos a "primeira camada" de auto-complete
 *     manualmente: builtins comuns + métodos de tipos básicos.
 *
 * Cobre ~60% do uso diário sem precisar de LSP real:
 *   - Python: print/len/range/str/int/list/dict/etc + os/sys/json/datetime
 *   - Go: fmt.Println/os.Args/len/append/make + tipos básicos
 *   - Rust: Vec/String/HashMap + println!/format!/Result/Option
 *
 * Quando V2 trouxer LSP real, esses providers podem ser desligados via flag —
 * o LSP-based vai dar completion melhor (cross-file, types corretos, etc).
 *
 * Cada item vira CompletionItem com:
 *   - kind apropriado (Function, Class, Module, Keyword, etc.)
 *   - documentation com signature/exemplo
 *   - sortText pra priorizar builtins sobre word-based
 */

import * as monaco from 'monaco-editor';

interface Builtin {
  label: string;
  kind: monaco.languages.CompletionItemKind;
  insertText: string;
  detail?: string;
  documentation?: string;
  // True se for snippet (com placeholders).
  snippet?: boolean;
}

// ====================== PYTHON ======================

const PYTHON_BUILTINS: Builtin[] = [
  // === I/O ===
  { label: 'print', kind: monaco.languages.CompletionItemKind.Function, insertText: 'print(${1})', snippet: true, detail: 'print(*objects, sep=" ", end="\\n")', documentation: 'Print to stdout.' },
  { label: 'input', kind: monaco.languages.CompletionItemKind.Function, insertText: 'input(${1:prompt})', snippet: true, detail: 'input(prompt) -> str', documentation: 'Read a line from stdin.' },
  { label: 'open', kind: monaco.languages.CompletionItemKind.Function, insertText: 'open(${1:path}, ${2:"r"})', snippet: true, detail: 'open(file, mode)', documentation: 'Open file. mode: r/w/a/rb/wb.' },

  // === Type conversion ===
  { label: 'str', kind: monaco.languages.CompletionItemKind.Class, insertText: 'str(${1})', snippet: true, detail: 'str(object) -> str', documentation: 'Convert to string.' },
  { label: 'int', kind: monaco.languages.CompletionItemKind.Class, insertText: 'int(${1})', snippet: true, detail: 'int(x) -> int', documentation: 'Convert to integer.' },
  { label: 'float', kind: monaco.languages.CompletionItemKind.Class, insertText: 'float(${1})', snippet: true, detail: 'float(x) -> float', documentation: 'Convert to float.' },
  { label: 'bool', kind: monaco.languages.CompletionItemKind.Class, insertText: 'bool(${1})', snippet: true, detail: 'bool(x) -> bool' },
  { label: 'list', kind: monaco.languages.CompletionItemKind.Class, insertText: 'list(${1:iterable})', snippet: true, detail: 'list(iterable) -> list' },
  { label: 'dict', kind: monaco.languages.CompletionItemKind.Class, insertText: 'dict(${1})', snippet: true, detail: 'dict(**kwargs) -> dict' },
  { label: 'tuple', kind: monaco.languages.CompletionItemKind.Class, insertText: 'tuple(${1:iterable})', snippet: true, detail: 'tuple(iterable) -> tuple' },
  { label: 'set', kind: monaco.languages.CompletionItemKind.Class, insertText: 'set(${1:iterable})', snippet: true, detail: 'set(iterable) -> set' },
  { label: 'frozenset', kind: monaco.languages.CompletionItemKind.Class, insertText: 'frozenset(${1:iterable})', snippet: true },
  { label: 'bytes', kind: monaco.languages.CompletionItemKind.Class, insertText: 'bytes(${1})', snippet: true, detail: 'bytes(source) -> bytes' },

  // === Sequence/iteration ===
  { label: 'len', kind: monaco.languages.CompletionItemKind.Function, insertText: 'len(${1})', snippet: true, detail: 'len(s) -> int', documentation: 'Length of sequence/collection.' },
  { label: 'range', kind: monaco.languages.CompletionItemKind.Function, insertText: 'range(${1:n})', snippet: true, detail: 'range(start, stop, step)', documentation: 'Generate range of integers.' },
  { label: 'enumerate', kind: monaco.languages.CompletionItemKind.Function, insertText: 'enumerate(${1:iterable})', snippet: true, detail: 'enumerate(iter) -> [(i, x), ...]', documentation: 'Enumerate with index.' },
  { label: 'zip', kind: monaco.languages.CompletionItemKind.Function, insertText: 'zip(${1:a}, ${2:b})', snippet: true, detail: 'zip(*iterables) -> tuples' },
  { label: 'map', kind: monaco.languages.CompletionItemKind.Function, insertText: 'map(${1:func}, ${2:iterable})', snippet: true, detail: 'map(func, iter) -> map' },
  { label: 'filter', kind: monaco.languages.CompletionItemKind.Function, insertText: 'filter(${1:func}, ${2:iterable})', snippet: true, detail: 'filter(func, iter) -> filter' },
  { label: 'reversed', kind: monaco.languages.CompletionItemKind.Function, insertText: 'reversed(${1:seq})', snippet: true },
  { label: 'sorted', kind: monaco.languages.CompletionItemKind.Function, insertText: 'sorted(${1:iterable})', snippet: true, detail: 'sorted(iter, key=None, reverse=False)' },
  { label: 'sum', kind: monaco.languages.CompletionItemKind.Function, insertText: 'sum(${1:iterable})', snippet: true },
  { label: 'min', kind: monaco.languages.CompletionItemKind.Function, insertText: 'min(${1})', snippet: true },
  { label: 'max', kind: monaco.languages.CompletionItemKind.Function, insertText: 'max(${1})', snippet: true },
  { label: 'abs', kind: monaco.languages.CompletionItemKind.Function, insertText: 'abs(${1})', snippet: true },
  { label: 'round', kind: monaco.languages.CompletionItemKind.Function, insertText: 'round(${1:n}, ${2:digits})', snippet: true },
  { label: 'any', kind: monaco.languages.CompletionItemKind.Function, insertText: 'any(${1:iterable})', snippet: true },
  { label: 'all', kind: monaco.languages.CompletionItemKind.Function, insertText: 'all(${1:iterable})', snippet: true },

  // === Reflection / type ===
  { label: 'type', kind: monaco.languages.CompletionItemKind.Function, insertText: 'type(${1})', snippet: true, detail: 'type(obj) -> class' },
  { label: 'isinstance', kind: monaco.languages.CompletionItemKind.Function, insertText: 'isinstance(${1:obj}, ${2:cls})', snippet: true },
  { label: 'issubclass', kind: monaco.languages.CompletionItemKind.Function, insertText: 'issubclass(${1:cls}, ${2:base})', snippet: true },
  { label: 'hasattr', kind: monaco.languages.CompletionItemKind.Function, insertText: 'hasattr(${1:obj}, ${2:"name"})', snippet: true },
  { label: 'getattr', kind: monaco.languages.CompletionItemKind.Function, insertText: 'getattr(${1:obj}, ${2:"name"})', snippet: true },
  { label: 'setattr', kind: monaco.languages.CompletionItemKind.Function, insertText: 'setattr(${1:obj}, ${2:"name"}, ${3:value})', snippet: true },
  { label: 'dir', kind: monaco.languages.CompletionItemKind.Function, insertText: 'dir(${1})', snippet: true, detail: 'dir(obj) -> [attrs]' },
  { label: 'vars', kind: monaco.languages.CompletionItemKind.Function, insertText: 'vars(${1})', snippet: true },
  { label: 'id', kind: monaco.languages.CompletionItemKind.Function, insertText: 'id(${1})', snippet: true },
  { label: 'hash', kind: monaco.languages.CompletionItemKind.Function, insertText: 'hash(${1})', snippet: true },
  { label: 'repr', kind: monaco.languages.CompletionItemKind.Function, insertText: 'repr(${1})', snippet: true },
  { label: 'callable', kind: monaco.languages.CompletionItemKind.Function, insertText: 'callable(${1})', snippet: true },

  // === Math (sem `import math`) ===
  { label: 'pow', kind: monaco.languages.CompletionItemKind.Function, insertText: 'pow(${1:x}, ${2:y})', snippet: true, detail: 'pow(x, y) -> x**y' },
  { label: 'divmod', kind: monaco.languages.CompletionItemKind.Function, insertText: 'divmod(${1:a}, ${2:b})', snippet: true },

  // === Common stdlib modules ===
  { label: 'os', kind: monaco.languages.CompletionItemKind.Module, insertText: 'os', detail: 'import os', documentation: 'Operating system interfaces. os.path, os.environ, os.getcwd(), os.listdir().' },
  { label: 'sys', kind: monaco.languages.CompletionItemKind.Module, insertText: 'sys', detail: 'import sys', documentation: 'System-specific params. sys.argv, sys.exit(), sys.path.' },
  { label: 'json', kind: monaco.languages.CompletionItemKind.Module, insertText: 'json', detail: 'import json', documentation: 'JSON encoder/decoder. json.loads(s), json.dumps(obj).' },
  { label: 'datetime', kind: monaco.languages.CompletionItemKind.Module, insertText: 'datetime', detail: 'from datetime import datetime', documentation: 'Date/time types.' },
  { label: 're', kind: monaco.languages.CompletionItemKind.Module, insertText: 're', detail: 'import re', documentation: 'Regular expressions. re.match, re.search, re.findall.' },
  { label: 'math', kind: monaco.languages.CompletionItemKind.Module, insertText: 'math', detail: 'import math', documentation: 'Math functions. math.pi, math.sqrt, math.log.' },
  { label: 'random', kind: monaco.languages.CompletionItemKind.Module, insertText: 'random', detail: 'import random', documentation: 'Random number generation.' },
  { label: 'collections', kind: monaco.languages.CompletionItemKind.Module, insertText: 'collections', detail: 'from collections import ...', documentation: 'Specialized container types: OrderedDict, defaultdict, Counter, deque.' },
  { label: 'itertools', kind: monaco.languages.CompletionItemKind.Module, insertText: 'itertools', detail: 'import itertools' },
  { label: 'pathlib', kind: monaco.languages.CompletionItemKind.Module, insertText: 'pathlib', detail: 'from pathlib import Path' },
  { label: 'typing', kind: monaco.languages.CompletionItemKind.Module, insertText: 'typing', detail: 'from typing import ...', documentation: 'Type hints. List, Dict, Optional, Union, Any.' },

  // === Keywords (Monaco já sugere mas reforça com docs) ===
  { label: 'lambda', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'lambda ${1:args}: ${2:expr}', snippet: true, detail: 'anonymous function' },
  { label: 'yield', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'yield ${1}', snippet: true },
  { label: 'async', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'async ', detail: 'async function' },
  { label: 'await', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'await ${1}', snippet: true },
  { label: 'None', kind: monaco.languages.CompletionItemKind.Constant, insertText: 'None' },
  { label: 'True', kind: monaco.languages.CompletionItemKind.Constant, insertText: 'True' },
  { label: 'False', kind: monaco.languages.CompletionItemKind.Constant, insertText: 'False' },

  // === Exceptions ===
  { label: 'Exception', kind: monaco.languages.CompletionItemKind.Class, insertText: 'Exception' },
  { label: 'ValueError', kind: monaco.languages.CompletionItemKind.Class, insertText: 'ValueError' },
  { label: 'TypeError', kind: monaco.languages.CompletionItemKind.Class, insertText: 'TypeError' },
  { label: 'KeyError', kind: monaco.languages.CompletionItemKind.Class, insertText: 'KeyError' },
  { label: 'IndexError', kind: monaco.languages.CompletionItemKind.Class, insertText: 'IndexError' },
  { label: 'FileNotFoundError', kind: monaco.languages.CompletionItemKind.Class, insertText: 'FileNotFoundError' },
  { label: 'RuntimeError', kind: monaco.languages.CompletionItemKind.Class, insertText: 'RuntimeError' },
  { label: 'StopIteration', kind: monaco.languages.CompletionItemKind.Class, insertText: 'StopIteration' },
];

// ====================== GO ======================

const GO_BUILTINS: Builtin[] = [
  { label: 'fmt.Println', kind: monaco.languages.CompletionItemKind.Function, insertText: 'fmt.Println(${1})', snippet: true, detail: 'fmt.Println(a ...any)', documentation: 'Print line to stdout.' },
  { label: 'fmt.Printf', kind: monaco.languages.CompletionItemKind.Function, insertText: 'fmt.Printf(${1:"%s\\n"}, ${2})', snippet: true },
  { label: 'fmt.Sprintf', kind: monaco.languages.CompletionItemKind.Function, insertText: 'fmt.Sprintf(${1:"%s"}, ${2})', snippet: true },
  { label: 'fmt.Errorf', kind: monaco.languages.CompletionItemKind.Function, insertText: 'fmt.Errorf(${1:"%w"}, ${2})', snippet: true },
  { label: 'len', kind: monaco.languages.CompletionItemKind.Function, insertText: 'len(${1})', snippet: true, detail: 'len(v) int' },
  { label: 'cap', kind: monaco.languages.CompletionItemKind.Function, insertText: 'cap(${1})', snippet: true, detail: 'cap(v) int' },
  { label: 'make', kind: monaco.languages.CompletionItemKind.Function, insertText: 'make(${1:[]int}, ${2:0})', snippet: true, detail: 'make(type, size)' },
  { label: 'new', kind: monaco.languages.CompletionItemKind.Function, insertText: 'new(${1:T})', snippet: true },
  { label: 'append', kind: monaco.languages.CompletionItemKind.Function, insertText: 'append(${1:slice}, ${2})', snippet: true },
  { label: 'copy', kind: monaco.languages.CompletionItemKind.Function, insertText: 'copy(${1:dst}, ${2:src})', snippet: true },
  { label: 'delete', kind: monaco.languages.CompletionItemKind.Function, insertText: 'delete(${1:map}, ${2:key})', snippet: true },
  { label: 'panic', kind: monaco.languages.CompletionItemKind.Function, insertText: 'panic(${1})', snippet: true },
  { label: 'recover', kind: monaco.languages.CompletionItemKind.Function, insertText: 'recover()' },
  { label: 'close', kind: monaco.languages.CompletionItemKind.Function, insertText: 'close(${1:ch})', snippet: true },
  { label: 'os.Args', kind: monaco.languages.CompletionItemKind.Variable, insertText: 'os.Args', detail: '[]string' },
  { label: 'os.Exit', kind: monaco.languages.CompletionItemKind.Function, insertText: 'os.Exit(${1:0})', snippet: true },
  { label: 'os.Getenv', kind: monaco.languages.CompletionItemKind.Function, insertText: 'os.Getenv(${1:"KEY"})', snippet: true },
  { label: 'strings.Contains', kind: monaco.languages.CompletionItemKind.Function, insertText: 'strings.Contains(${1:s}, ${2:substr})', snippet: true },
  { label: 'strings.Split', kind: monaco.languages.CompletionItemKind.Function, insertText: 'strings.Split(${1:s}, ${2:sep})', snippet: true },
  { label: 'strings.Join', kind: monaco.languages.CompletionItemKind.Function, insertText: 'strings.Join(${1:slice}, ${2:sep})', snippet: true },
  { label: 'strings.TrimSpace', kind: monaco.languages.CompletionItemKind.Function, insertText: 'strings.TrimSpace(${1:s})', snippet: true },
  { label: 'errors.New', kind: monaco.languages.CompletionItemKind.Function, insertText: 'errors.New(${1:"msg"})', snippet: true },
  { label: 'errors.Is', kind: monaco.languages.CompletionItemKind.Function, insertText: 'errors.Is(${1:err}, ${2:target})', snippet: true },
  { label: 'context.Background', kind: monaco.languages.CompletionItemKind.Function, insertText: 'context.Background()' },
  { label: 'context.TODO', kind: monaco.languages.CompletionItemKind.Function, insertText: 'context.TODO()' },
  // Tipos básicos
  { label: 'string', kind: monaco.languages.CompletionItemKind.TypeParameter, insertText: 'string' },
  { label: 'int', kind: monaco.languages.CompletionItemKind.TypeParameter, insertText: 'int' },
  { label: 'int64', kind: monaco.languages.CompletionItemKind.TypeParameter, insertText: 'int64' },
  { label: 'float64', kind: monaco.languages.CompletionItemKind.TypeParameter, insertText: 'float64' },
  { label: 'bool', kind: monaco.languages.CompletionItemKind.TypeParameter, insertText: 'bool' },
  { label: 'byte', kind: monaco.languages.CompletionItemKind.TypeParameter, insertText: 'byte' },
  { label: 'rune', kind: monaco.languages.CompletionItemKind.TypeParameter, insertText: 'rune' },
  { label: 'error', kind: monaco.languages.CompletionItemKind.TypeParameter, insertText: 'error' },
  { label: 'nil', kind: monaco.languages.CompletionItemKind.Constant, insertText: 'nil' },
  { label: 'true', kind: monaco.languages.CompletionItemKind.Constant, insertText: 'true' },
  { label: 'false', kind: monaco.languages.CompletionItemKind.Constant, insertText: 'false' },
];

// ====================== RUST ======================

const RUST_BUILTINS: Builtin[] = [
  // Macros
  { label: 'println!', kind: monaco.languages.CompletionItemKind.Function, insertText: 'println!(${1:"{}"}, ${2});', snippet: true, detail: 'println!(format, args...)' },
  { label: 'print!', kind: monaco.languages.CompletionItemKind.Function, insertText: 'print!(${1:"{}"}, ${2});', snippet: true },
  { label: 'eprintln!', kind: monaco.languages.CompletionItemKind.Function, insertText: 'eprintln!(${1:"{}"}, ${2});', snippet: true, detail: 'print to stderr' },
  { label: 'format!', kind: monaco.languages.CompletionItemKind.Function, insertText: 'format!(${1:"{}"}, ${2})', snippet: true, detail: 'format!(format, args...) -> String' },
  { label: 'vec!', kind: monaco.languages.CompletionItemKind.Function, insertText: 'vec![${1}]', snippet: true, detail: 'vec![items...] -> Vec<T>' },
  { label: 'panic!', kind: monaco.languages.CompletionItemKind.Function, insertText: 'panic!(${1:"msg"})', snippet: true },
  { label: 'assert!', kind: monaco.languages.CompletionItemKind.Function, insertText: 'assert!(${1:cond})', snippet: true },
  { label: 'assert_eq!', kind: monaco.languages.CompletionItemKind.Function, insertText: 'assert_eq!(${1:a}, ${2:b})', snippet: true },
  { label: 'dbg!', kind: monaco.languages.CompletionItemKind.Function, insertText: 'dbg!(${1})', snippet: true, detail: 'dbg!(value) — print + return' },
  { label: 'todo!', kind: monaco.languages.CompletionItemKind.Function, insertText: 'todo!()' },
  { label: 'unimplemented!', kind: monaco.languages.CompletionItemKind.Function, insertText: 'unimplemented!()' },

  // Std types
  { label: 'String', kind: monaco.languages.CompletionItemKind.Class, insertText: 'String', detail: 'String — owned, heap-allocated UTF-8' },
  { label: 'Vec', kind: monaco.languages.CompletionItemKind.Class, insertText: 'Vec<${1:T}>', snippet: true, detail: 'Vec<T> — growable array' },
  { label: 'HashMap', kind: monaco.languages.CompletionItemKind.Class, insertText: 'HashMap<${1:K}, ${2:V}>', snippet: true, detail: 'use std::collections::HashMap' },
  { label: 'HashSet', kind: monaco.languages.CompletionItemKind.Class, insertText: 'HashSet<${1:T}>', snippet: true },
  { label: 'BTreeMap', kind: monaco.languages.CompletionItemKind.Class, insertText: 'BTreeMap<${1:K}, ${2:V}>', snippet: true },
  { label: 'Option', kind: monaco.languages.CompletionItemKind.Enum, insertText: 'Option<${1:T}>', snippet: true, detail: 'Option<T> = Some(T) | None' },
  { label: 'Result', kind: monaco.languages.CompletionItemKind.Enum, insertText: 'Result<${1:T}, ${2:E}>', snippet: true, detail: 'Result<T, E> = Ok(T) | Err(E)' },
  { label: 'Box', kind: monaco.languages.CompletionItemKind.Class, insertText: 'Box<${1:T}>', snippet: true, detail: 'Box<T> — heap pointer' },
  { label: 'Rc', kind: monaco.languages.CompletionItemKind.Class, insertText: 'Rc<${1:T}>', snippet: true, detail: 'Rc<T> — reference counted' },
  { label: 'Arc', kind: monaco.languages.CompletionItemKind.Class, insertText: 'Arc<${1:T}>', snippet: true, detail: 'Arc<T> — atomic reference counted (thread-safe)' },
  { label: 'RefCell', kind: monaco.languages.CompletionItemKind.Class, insertText: 'RefCell<${1:T}>', snippet: true },
  { label: 'Mutex', kind: monaco.languages.CompletionItemKind.Class, insertText: 'Mutex<${1:T}>', snippet: true },

  // Primitives
  { label: 'i32', kind: monaco.languages.CompletionItemKind.TypeParameter, insertText: 'i32' },
  { label: 'i64', kind: monaco.languages.CompletionItemKind.TypeParameter, insertText: 'i64' },
  { label: 'u32', kind: monaco.languages.CompletionItemKind.TypeParameter, insertText: 'u32' },
  { label: 'u64', kind: monaco.languages.CompletionItemKind.TypeParameter, insertText: 'u64' },
  { label: 'usize', kind: monaco.languages.CompletionItemKind.TypeParameter, insertText: 'usize' },
  { label: 'isize', kind: monaco.languages.CompletionItemKind.TypeParameter, insertText: 'isize' },
  { label: 'f32', kind: monaco.languages.CompletionItemKind.TypeParameter, insertText: 'f32' },
  { label: 'f64', kind: monaco.languages.CompletionItemKind.TypeParameter, insertText: 'f64' },
  { label: 'bool', kind: monaco.languages.CompletionItemKind.TypeParameter, insertText: 'bool' },
  { label: 'char', kind: monaco.languages.CompletionItemKind.TypeParameter, insertText: 'char' },
  { label: 'str', kind: monaco.languages.CompletionItemKind.TypeParameter, insertText: 'str', detail: '&str — string slice' },

  // Constants
  { label: 'Some', kind: monaco.languages.CompletionItemKind.Constructor, insertText: 'Some(${1})', snippet: true },
  { label: 'None', kind: monaco.languages.CompletionItemKind.Constant, insertText: 'None' },
  { label: 'Ok', kind: monaco.languages.CompletionItemKind.Constructor, insertText: 'Ok(${1})', snippet: true },
  { label: 'Err', kind: monaco.languages.CompletionItemKind.Constructor, insertText: 'Err(${1})', snippet: true },
  { label: 'true', kind: monaco.languages.CompletionItemKind.Constant, insertText: 'true' },
  { label: 'false', kind: monaco.languages.CompletionItemKind.Constant, insertText: 'false' },
];

let registered = false;

function makeProvider(builtins: Builtin[]): monaco.languages.CompletionItemProvider {
  return {
    // Trigger em `.` ajuda em Go (`fmt.`) e Python (`os.`).
    triggerCharacters: ['.'],
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      // Quando user já digitou parte (ex: "fmt.Pri"), word.startColumn aponta
      // ao primeiro char da palavra. Pra labels com `.` (fmt.Println), o range
      // precisa cobrir desde antes do `.`. Heurística: olha 30 chars à esquerda.
      const lineContent = model.getLineContent(position.lineNumber);
      const beforeCursor = lineContent.slice(0, position.column - 1);
      const dotMatch = /([\w.]+)$/.exec(beforeCursor);
      const range = dotMatch
        ? new monaco.Range(
            position.lineNumber, position.column - dotMatch[1].length,
            position.lineNumber, word.endColumn,
          )
        : new monaco.Range(
            position.lineNumber, word.startColumn,
            position.lineNumber, word.endColumn,
          );

      return {
        suggestions: builtins.map((b) => ({
          label: b.label,
          kind: b.kind,
          insertText: b.insertText,
          insertTextRules: b.snippet
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : monaco.languages.CompletionItemInsertTextRule.KeepWhitespace,
          detail: b.detail,
          documentation: b.documentation
            ? { value: b.documentation }
            : undefined,
          range,
          // Boost: prioriza builtins acima de word-based.
          sortText: `1_${b.label}`,
        })),
      };
    },
  };
}

export function registerLanguageBuiltins(): void {
  if (registered) return;
  registered = true;

  monaco.languages.registerCompletionItemProvider('python', makeProvider(PYTHON_BUILTINS));
  monaco.languages.registerCompletionItemProvider('go', makeProvider(GO_BUILTINS));
  monaco.languages.registerCompletionItemProvider('rust', makeProvider(RUST_BUILTINS));

  // eslint-disable-next-line no-console
  console.log('[Monaco] Language builtins registered:', {
    python: PYTHON_BUILTINS.length,
    go: GO_BUILTINS.length,
    rust: RUST_BUILTINS.length,
  });
}
