import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { Check, Copy } from "lucide-react";
import { memo, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "../lib/platform";
import { normalizeMarkdownMath } from "../lib/markdown";

function externalTarget(href?: string) {
  if (!href) return undefined;
  try {
    const url = new URL(href);
    return ["http:", "https:"].includes(url.protocol) ? url : undefined;
  } catch { return undefined; }
}

function CodeBlock({ className, children }: { className?: string; children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = String(children ?? "").replace(/\n$/, "");
  const inline = !className && !text.includes("\n");
  if (inline) return <code className="inline-code">{children}</code>;
  const language = className?.replace("language-", "") || "text";
  return (
    <div className="code-block">
      <div className="code-toolbar">
        <span>{language}</span>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          }}
          aria-label="复制代码"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          <span>{copied ? "已复制" : "复制"}</span>
        </button>
      </div>
      <pre tabIndex={0}>
        <code className={className}>{text}</code>
      </pre>
    </div>
  );
}

export const MarkdownMessage = memo(function MarkdownMessage({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeSanitize, rehypeKatex]}
        components={{
          a: ({ href, children: linkChildren }) => {
            const target = externalTarget(href);
            return <a href={target?.toString()} aria-label={target ? `使用系统浏览器打开 ${target.hostname}` : "无效外部链接"} onClick={(event) => {
              event.preventDefault();
              if (!target) return;
              if (isTauri()) void openUrl(target.toString());
              else window.open(target.toString(), "_blank", "noopener,noreferrer");
            }}>{linkChildren}</a>;
          },
          code: ({ className, children: codeChildren }) => <CodeBlock className={className}>{codeChildren}</CodeBlock>
        }}
      >
        {normalizeMarkdownMath(children)}
      </ReactMarkdown>
    </div>
  );
});
