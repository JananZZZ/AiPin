const fencedBlock = /(```|~~~)([^\n]*)\n([\s\S]*?)\1/g;
const inlineCode = /(`+)([^`]*?)\1/g;

const unicodeOperators: Record<string, string> = {
  "≤": "\\le ", "≥": "\\ge ", "≠": "\\ne ", "≈": "\\approx ", "≡": "\\equiv ",
  "×": "\\times ", "÷": "\\div ", "±": "\\pm ", "∓": "\\mp ", "∞": "\\infty ",
  "∑": "\\sum ", "∏": "\\prod ", "∫": "\\int ", "∂": "\\partial ", "∇": "\\nabla ",
  "→": "\\to ", "←": "\\leftarrow ", "↔": "\\leftrightarrow ", "⇒": "\\Rightarrow ",
  "∈": "\\in ", "∉": "\\notin ", "∅": "\\varnothing ", "∧": "\\land ", "∨": "\\lor ",
  "·": "\\cdot ", "⊂": "\\subset ", "⊆": "\\subseteq ", "⊃": "\\supset ", "⊇": "\\supseteq "
};

const superscripts: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁺": "+", "⁻": "-" };
const subscripts: Record<string, string> = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9", "₊": "+", "₋": "-" };
const greek: Record<string, string> = {
  alpha: "\\alpha", beta: "\\beta", gamma: "\\gamma", delta: "\\delta", epsilon: "\\epsilon",
  theta: "\\theta", lambda: "\\lambda", mu: "\\mu", pi: "\\pi", rho: "\\rho", sigma: "\\sigma",
  phi: "\\phi", psi: "\\psi", omega: "\\omega", Gamma: "\\Gamma", Delta: "\\Delta",
  Theta: "\\Theta", Lambda: "\\Lambda", Pi: "\\Pi", Sigma: "\\Sigma", Phi: "\\Phi", Psi: "\\Psi", Omega: "\\Omega"
};

function normalizeUnicodeFormula(value: string) {
  return value
    .replace(/√\(([^()]*)\)/g, "\\sqrt{$1}")
    .replace(/√([\p{L}\p{N}]+)/gu, "\\sqrt{$1}")
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/g, (run) => `^{${[...run].map((item) => superscripts[item]).join("")}}`)
    .replace(/[₀₁₂₃₄₅₆₇₈₉₊₋]+/g, (run) => `_{${[...run].map((item) => subscripts[item]).join("")}}`)
    .replace(/[≤≥≠≈≡×÷±∓∞∑∏∫∂∇→←↔⇒∈∉∅∧∨·⊂⊆⊃⊇]/g, (item) => unicodeOperators[item])
    .replace(/½/g, "\\frac{1}{2}")
    .replace(/⅓/g, "\\frac{1}{3}")
    .replace(/⅔/g, "\\frac{2}{3}")
    .replace(/¼/g, "\\frac{1}{4}")
    .replace(/¾/g, "\\frac{3}{4}");
}

function replaceBalancedFunction(source: string, name: string, wrap: (content: string) => string) {
  let output = source;
  let searchFrom = 0;
  while (searchFrom < output.length) {
    const start = output.indexOf(`${name}(`, searchFrom);
    if (start < 0) break;
    let depth = 1;
    let end = start + name.length + 1;
    for (; end < output.length && depth > 0; end += 1) {
      if (output[end] === "(") depth += 1;
      else if (output[end] === ")") depth -= 1;
    }
    if (depth !== 0) break;
    const content = output.slice(start + name.length + 1, end - 1);
    output = `${output.slice(0, start)}${wrap(asciiMathToLatex(content))}${output.slice(end)}`;
    searchFrom = start + 1;
  }
  return output;
}

/** Convert the common deterministic AsciiMath subset without a second renderer. */
export function asciiMathToLatex(source: string) {
  let output = source.trim();
  for (const [name, wrap] of [
    ["sqrt", (value: string) => `\\sqrt{${value}}`],
    ["abs", (value: string) => `\\left|${value}\\right|`],
    ["floor", (value: string) => `\\left\\lfloor ${value} \\right\\rfloor`],
    ["ceil", (value: string) => `\\left\\lceil ${value} \\right\\rceil`]
  ] as const) output = replaceBalancedFunction(output, name, wrap);
  output = output
    .replace(/root\(([^()]*)\)\(([^()]*)\)/g, "\\sqrt[$1]{$2}")
    .replace(/frac\(([^()]*)\)\(([^()]*)\)/g, "\\frac{$1}{$2}");
  for (let pass = 0; pass < 8; pass += 1) {
    const next = output.replace(/([_^])\(([^()]*)\)/g, "$1{$2}");
    if (next === output) break;
    output = next;
  }
  output = output
    .replace(/<=/g, "\\le ").replace(/>=/g, "\\ge ").replace(/!=/g, "\\ne ")
    .replace(/->/g, "\\to ").replace(/<-/g, "\\leftarrow ")
    .replace(/\boo\b/g, "\\infty")
    .replace(/\bsum(?=_|\^|\s|$)/g, "\\sum").replace(/\bprod(?=_|\^|\s|$)/g, "\\prod").replace(/\bint(?=_|\^|\s|$)/g, "\\int")
    .replace(/\b(alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|rho|sigma|phi|psi|omega|Gamma|Delta|Theta|Lambda|Pi|Sigma|Phi|Psi|Omega)\b/g, (name) => greek[name]);
  return normalizeUnicodeFormula(output);
}

interface MathNode { name: string; attributes: Record<string, string>; children: MathNode[]; text?: string }

function decodeXml(value: string) {
  return value.replace(/&(?:#x([\da-f]+)|#(\d+)|([a-z]+));/gi, (entity, hex: string, decimal: string, named: string) => {
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
    return ({ amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" } as Record<string, string>)[named.toLowerCase()] ?? entity;
  });
}

function parseAttributes(source: string) {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attributes[match[1].toLowerCase()] = decodeXml(match[2] ?? match[3] ?? "");
  return attributes;
}

function parseMathMl(source: string): MathNode | undefined {
  if (source.length > 20_000) return undefined;
  const root: MathNode = { name: "root", attributes: {}, children: [] };
  const stack = [root];
  let nodes = 0;
  for (const token of source.match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) ?? []) {
    if (token.startsWith("<!--") || token.startsWith("<?") || token.startsWith("<!")) continue;
    if (token.startsWith("</")) {
      const closing = token.match(/^<\/\s*([^\s>]+)\s*>$/)?.[1].split(":").at(-1)?.toLowerCase();
      if (!closing || stack.length <= 1 || stack.at(-1)!.name !== closing) return undefined;
      stack.pop();
      continue;
    }
    if (token.startsWith("<")) {
      const match = token.match(/^<\s*([^\s/>]+)([\s\S]*?)\/?\s*>$/);
      if (!match || ++nodes > 2_000 || stack.length > 32) return undefined;
      const node: MathNode = { name: match[1].split(":").at(-1)!.toLowerCase(), attributes: parseAttributes(match[2]), children: [] };
      stack.at(-1)!.children.push(node);
      if (!/\/\s*>$/.test(token)) stack.push(node);
      continue;
    }
    if (token.trim()) stack.at(-1)!.children.push({ name: "#text", attributes: {}, children: [], text: decodeXml(token) });
  }
  if (stack.length !== 1) return undefined;
  return root.children.find((node) => node.name === "math") ?? root.children[0];
}

function escapeText(value: string) {
  return value.replace(/[\\{}%#$&_~^]/g, (character) => ({ "~": "\\textasciitilde{}", "^": "\\textasciicircum{}" }[character] ?? `\\${character}`));
}
function nodeText(node: MathNode): string { return node.children.map((child) => child.text ?? nodeText(child)).join("").trim(); }
function mathDelimiter(value: string) { return ({ "(": "(", ")": ")", "[": "[", "]": "]", "{": "\\{", "}": "\\}", "|": "|" } as Record<string, string>)[value] ?? "."; }

function renderMathNode(node: MathNode): string {
  const children = () => node.children.map(renderMathNode).join("");
  const child = (index: number) => node.children[index] ? renderMathNode(node.children[index]) : "";
  if (node.name === "#text") return normalizeUnicodeFormula(node.text?.trim() ?? "");
  if (["script", "style", "annotation", "annotation-xml"].includes(node.name)) return "";
  if (node.name === "mi") return greek[nodeText(node)] ?? normalizeUnicodeFormula(nodeText(node));
  if (node.name === "mn" || node.name === "mo") return normalizeUnicodeFormula(nodeText(node));
  if (node.name === "mtext" || node.name === "ms") return `\\text{${escapeText(nodeText(node))}}`;
  if (node.name === "mfrac") return `\\frac{${child(0)}}{${child(1)}}`;
  if (node.name === "msqrt") return `\\sqrt{${children()}}`;
  if (node.name === "mroot") return `\\sqrt[${child(1)}]{${child(0)}}`;
  if (node.name === "msup") return `{${child(0)}}^{${child(1)}}`;
  if (node.name === "msub") return `{${child(0)}}_{${child(1)}}`;
  if (node.name === "msubsup") return `{${child(0)}}_{${child(1)}}^{${child(2)}}`;
  if (node.name === "mover") return `\\overset{${child(1)}}{${child(0)}}`;
  if (node.name === "munder") return `\\underset{${child(1)}}{${child(0)}}`;
  if (node.name === "munderover") return `\\overset{${child(2)}}{\\underset{${child(1)}}{${child(0)}}}`;
  if (node.name === "mfenced") return `\\left${mathDelimiter(node.attributes.open ?? "(")}${children()}\\right${mathDelimiter(node.attributes.close ?? ")")}`;
  if (node.name === "mspace") return "\\,";
  if (node.name === "mtd") return children();
  if (node.name === "mtr") return node.children.map(renderMathNode).join(" & ");
  if (node.name === "mtable") return `\\begin{matrix}${node.children.map(renderMathNode).join(" \\\\ ")}\\end{matrix}`;
  if (node.name === "semantics") return node.children.map(renderMathNode).find(Boolean) ?? "";
  return children();
}

/** Safely convert presentation MathML into the internal LaTeX/KaTeX pipeline. */
export function mathMlToLatex(source: string) {
  const tree = parseMathMl(source);
  return tree ? renderMathNode(tree).trim() : "";
}

function displayMath(formula: string) { return `\n\n$$\n${formula.trim()}\n$$\n\n`; }

function normalizeProseMath(value: string) {
  const normalizePlain = (plain: string) => plain
    .replace(/<math\b[^>]*>[\s\S]*?<\/math>/gi, (mathml) => {
      const formula = mathMlToLatex(mathml);
      return formula ? displayMath(formula) : `\n\n\`\`\`xml\n${mathml}\n\`\`\`\n\n`;
    })
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, formula: string) => displayMath(normalizeUnicodeFormula(formula)))
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, formula: string) => `$${normalizeUnicodeFormula(formula.trim())}$`)
    .replace(/\\begin\{(equation\*?|align\*?|gather\*?|multline\*?)\}([\s\S]*?)\\end\{\1\}/g,
      (_match, _environment: string, formula: string) => displayMath(normalizeUnicodeFormula(formula)))
    .replace(/\$\$([\s\S]*?)\$\$/g, (_match, formula: string) => `$$${normalizeUnicodeFormula(formula)}$$`)
    .replace(/(?<!\$)\$([^$\n]+)\$(?!\$)/g, (_match, formula: string) => `$${normalizeUnicodeFormula(formula)}$`)
    .replace(/\n{3,}/g, "\n\n");

  let output = "";
  let cursor = 0;
  for (const match of value.matchAll(inlineCode)) {
    const index = match.index ?? 0;
    output += normalizePlain(value.slice(cursor, index));
    output += match[0];
    cursor = index + match[0].length;
  }
  return output + normalizePlain(value.slice(cursor));
}

/** Normalize provider math dialects to one sanitized Markdown + LaTeX pipeline. */
export function normalizeMarkdownMath(source: string) {
  let output = "";
  let cursor = 0;
  for (const match of source.matchAll(fencedBlock)) {
    const index = match.index ?? 0;
    output += normalizeProseMath(source.slice(cursor, index));
    const language = match[2].trim().toLowerCase();
    const body = match[3].trim();
    if (["math", "latex", "tex", "unicode-math"].includes(language)) output += displayMath(normalizeUnicodeFormula(body));
    else if (["asciimath", "ascii-math"].includes(language)) output += displayMath(asciiMathToLatex(body));
    else if (language === "mathml") {
      const formula = mathMlToLatex(body.includes("<math") ? body : `<math>${body}</math>`);
      output += formula ? displayMath(formula) : match[0];
    } else output += match[0];
    cursor = index + match[0].length;
  }
  return (output + normalizeProseMath(source.slice(cursor))).trim();
}
