import { describe, expect, it } from "vitest";
import { asciiMathToLatex, mathMlToLatex, normalizeMarkdownMath } from "../src/lib/markdown";

describe("Markdown math normalization", () => {
  it("normalizes common inline and display LaTeX delimiters", () => {
    expect(normalizeMarkdownMath("行内 \\(x^2\\) 与块级：\\[y=mx+b\\]"))
      .toBe("行内 $x^2$ 与块级：\n\n$$\ny=mx+b\n$$");
  });

  it("turns dedicated math fences and equation environments into display math", () => {
    expect(normalizeMarkdownMath("```latex\n\\frac{1}{2}\n```"))
      .toBe("$$\n\\frac{1}{2}\n$$");
    expect(normalizeMarkdownMath("\\begin{align*}\na&=b\\\\\nc&=d\n\\end{align*}"))
      .toBe("$$\na&=b\\\\\nc&=d\n$$");
  });

  it("never rewrites LaTeX-looking content inside ordinary code", () => {
    const source = "`\\(literal\\)`\n\n```js\nconst x = '\\\\[raw\\\\]';\n```";
    expect(normalizeMarkdownMath(source)).toBe(source);
  });

  it("normalizes AsciiMath and Unicode math fences into display math", () => {
    expect(asciiMathToLatex("sum_(i=1)^n sqrt(i^2) <= oo"))
      .toBe("\\sum_{i=1}^n \\sqrt{i^2} \\le  \\infty");
    expect(normalizeMarkdownMath("```unicode-math\nx² + y² ≤ z²\n```"))
      .toContain("x^{2} + y^{2} \\le  z^{2}");
  });

  it("converts safe presentation MathML, including fractions and scripts", () => {
    const mathml = "<math><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mfrac><mn>1</mn><mi>y</mi></mfrac></math>";
    expect(mathMlToLatex(mathml)).toBe("{x}^{2}+\\frac{1}{y}");
    expect(normalizeMarkdownMath(mathml)).toBe("$$\n{x}^{2}+\\frac{1}{y}\n$$");
  });

  it("drops executable MathML nodes instead of rendering remote markup", () => {
    expect(mathMlToLatex("<math><mi>x</mi><script>alert(1)</script><mo>=</mo><mn>1</mn></math>"))
      .toBe("x=1");
  });

  it("rejects malformed MathML nesting and escapes text-mode control characters", () => {
    expect(mathMlToLatex("<math><mfrac><mi>x</mfrac></mi></math>")).toBe("");
    expect(mathMlToLatex("<math><mtext>a_b%20</mtext></math>"))
      .toBe("\\text{a\\_b\\%20}");
  });
});
