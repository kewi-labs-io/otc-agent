import { Lexer } from "marked";
import dynamic from "next/dynamic";
import { type ComponentProps, memo, useMemo } from "react";
import type { MarkdownBlockProps, MemoizedMarkdownProps } from "@/types";

const Markdown = dynamic(() => import("markdown-to-jsx"), {
  ssr: true,
});

// Extract the options type from the Markdown component's props
type MarkdownComponentOptions = ComponentProps<typeof Markdown>["options"];

function parseMarkdownIntoBlocks(markdown: string): string[] {
  const lexer = new Lexer();
  const tokens = lexer.lex(markdown);
  return tokens.map((token) => token.raw);
}

const MemoizedMarkdownBlock = memo(
  ({ content, options }: MarkdownBlockProps) => {
    // Cast to library's options type - our MarkdownOptions is a compatible subset
    return <Markdown options={options as MarkdownComponentOptions}>{content}</Markdown>;
  },
  (prevProps, nextProps) => prevProps.content === nextProps.content,
);

MemoizedMarkdownBlock.displayName = "MemoizedMarkdownBlock";

export const MemoizedMarkdown = memo(({ content, id, options }: MemoizedMarkdownProps) => {
  const blocks = useMemo(() => parseMarkdownIntoBlocks(content), [content]);

  // Using index in key is acceptable here - blocks are derived deterministically from
  // content and don't reorder; the composite key includes the message id for uniqueness
  return blocks.map((block, index) => (
    <MemoizedMarkdownBlock
      content={block}
      options={options}
      key={`${id}-${block.slice(0, 20)}-${index}`}
    />
  ));
});

MemoizedMarkdown.displayName = "MemoizedMarkdown";
