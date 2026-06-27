// web/highlight.mjs - a tiny, dependency-free, language-aware syntax tokenizer.
//
// Why not highlight.js / Prism / a CDN? The kit forbids CDN loads and ships no
// bundler, and a full highlighter is large + licence-encumbered. This is a
// single self-contained scanner that produces *tokens* (not HTML), so the view
// renders them through Preact text nodes - XSS-safe by construction (code is
// never fed to innerHTML). It covers the languages this repo actually uses well
// and degrades gracefully to strings/numbers/comments for anything else.

// file extension -> language id
const EXT = {
  js: "js", mjs: "js", cjs: "js", jsx: "js",
  ts: "ts", tsx: "ts", mts: "ts", cts: "ts",
  json: "json", jsonc: "json",
  py: "py", pyi: "py",
  go: "go",
  rs: "rust",
  java: "java", kt: "java", kts: "java", scala: "java", swift: "java", dart: "java",
  c: "c", h: "c", cc: "c", cpp: "c", hpp: "c", cxx: "c", cs: "c",
  rb: "ruby",
  php: "php",
  css: "css", scss: "css", less: "css",
  html: "html", htm: "html", xml: "html", svg: "html", vue: "html",
  sh: "sh", bash: "sh", zsh: "sh",
  yml: "yaml", yaml: "yaml", toml: "yaml",
  md: "md", markdown: "md",
};

const KW = {
  js: "await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield async as",
  ts: "await break case catch class const continue debugger declare default delete do else enum export extends finally for from function get if implements import in infer instanceof interface keyof let namespace new of readonly return satisfies set static super switch this throw try type typeof var void while with yield async as abstract public private protected",
  py: "and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case",
  go: "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var",
  rust: "as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while",
  java: "abstract assert break case catch class const continue default do else enum extends final finally for goto if implements import instanceof interface native new package private protected public return static strictfp super switch synchronized this throw throws transient try void volatile while var val fun let func guard",
  c: "auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while bool class namespace template public private protected virtual using new delete",
  ruby: "alias and begin break case class def defined do else elsif end ensure for if in module next nil not or redo rescue retry return self super then unless until when while yield",
  php: "abstract and array as break case catch class const continue declare default do echo else elseif empty endfor endforeach endif endswitch endwhile extends final finally fn for foreach function global if implements include instanceof interface isset list namespace new or print private protected public require return static switch throw trait try unset use var while yield",
  css: "important from to and not only media supports keyframes import charset font-face",
  sh: "if then else elif fi for while do done case esac in function select until return export local readonly declare echo",
  yaml: "",
  html: "",
  json: "",
  md: "",
};

const LIT = {
  js: "true false null undefined NaN Infinity",
  ts: "true false null undefined NaN Infinity",
  py: "True False None",
  go: "true false nil iota",
  rust: "true false None Some Ok Err",
  java: "true false null",
  c: "true false NULL nullptr",
  ruby: "true false nil",
  php: "true false null TRUE FALSE NULL",
  css: "",
  sh: "true false",
  yaml: "true false null yes no",
  html: "",
  json: "true false null",
  md: "",
};

const set = (s) => new Set((s || "").split(/\s+/).filter(Boolean));

const LANGS = {};
for (const id of new Set(Object.values(EXT))) {
  const hash = id === "py" || id === "ruby" || id === "sh" || id === "yaml";
  LANGS[id] = {
    line: id === "css" || id === "html" || id === "yaml" ? (id === "yaml" ? "#" : null) : hash ? "#" : "//",
    block: id === "html" ? ["<!--", "-->"] : id === "py" || id === "sh" || id === "yaml" ? null : ["/*", "*/"],
    quotes: id === "html" ? ['"', "'"] : ['"', "'", "`"],
    triple: id === "py",
    kw: set(KW[id]),
    lit: set(LIT[id]),
    pascalType: id === "ts" || id === "js" || id === "java" || id === "go" || id === "rust" || id === "c",
  };
}
LANGS.unknown = { line: null, block: null, quotes: ['"', "'"], triple: false, kw: new Set(), lit: new Set(), pascalType: false };

export function languageFor(file) {
  const ext = String(file || "").toLowerCase().split(".").pop();
  return EXT[ext] || "unknown";
}

const isIdStart = (c) => /[A-Za-z_$]/.test(c);
const isId = (c) => /[A-Za-z0-9_$]/.test(c);

/** Tokenize a whole snippet (tokens may span newlines, e.g. block comments). */
export function tokenize(code, lang) {
  const cfg = LANGS[lang] || LANGS.unknown;
  const out = [];
  const n = code.length;
  let i = 0;
  const push = (t, v) => {
    if (v) out.push({ t, v });
  };
  while (i < n) {
    const c = code[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      let j = i + 1;
      while (j < n && (code[j] === " " || code[j] === "\t" || code[j] === "\n" || code[j] === "\r")) j++;
      push("text", code.slice(i, j));
      i = j;
      continue;
    }
    if (cfg.line && code.startsWith(cfg.line, i)) {
      let j = code.indexOf("\n", i);
      if (j < 0) j = n;
      push("com", code.slice(i, j));
      i = j;
      continue;
    }
    if (cfg.block && code.startsWith(cfg.block[0], i)) {
      let j = code.indexOf(cfg.block[1], i + cfg.block[0].length);
      j = j < 0 ? n : j + cfg.block[1].length;
      push("com", code.slice(i, j));
      i = j;
      continue;
    }
    if (cfg.triple) {
      const tq = code.startsWith('"""', i) ? '"""' : code.startsWith("'''", i) ? "'''" : null;
      if (tq) {
        let j = code.indexOf(tq, i + 3);
        j = j < 0 ? n : j + 3;
        push("str", code.slice(i, j));
        i = j;
        continue;
      }
    }
    if (cfg.quotes.includes(c)) {
      let j = i + 1;
      while (j < n) {
        if (code[j] === "\\") {
          j += 2;
          continue;
        }
        if (code[j] === c) {
          j++;
          break;
        }
        if (code[j] === "\n" && c !== "`") break; // unterminated single-line string
        j++;
      }
      push("str", code.slice(i, j));
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(code[i + 1] || ""))) {
      let j = i + 1;
      while (j < n && /[0-9a-fA-FxXoObB._eE+-]/.test(code[j])) {
        // stop a trailing +/- that isn't part of an exponent
        if ((code[j] === "+" || code[j] === "-") && !/[eE]/.test(code[j - 1])) break;
        j++;
      }
      push("num", code.slice(i, j));
      i = j;
      continue;
    }
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isId(code[j])) j++;
      const word = code.slice(i, j);
      let t = "text";
      if (cfg.kw.has(word)) t = "kw";
      else if (cfg.lit.has(word)) t = "lit";
      else {
        let k = j;
        while (k < n && code[k] === " ") k++;
        if (code[k] === "(") t = "fn";
        else if (cfg.pascalType && /^[A-Z]/.test(word)) t = "type";
      }
      push(t, word);
      i = j;
      continue;
    }
    push("punct", c);
    i++;
  }
  return out;
}

/** Split a flat token list into per-line token arrays (handles multiline tokens). */
export function toLines(tokens) {
  const lines = [[]];
  for (const tok of tokens) {
    const parts = tok.v.split("\n");
    for (let p = 0; p < parts.length; p++) {
      if (p > 0) lines.push([]);
      if (parts[p] !== "") lines[lines.length - 1].push({ t: tok.t, v: parts[p] });
    }
  }
  return lines;
}
