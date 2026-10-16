// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Hoisted out of the component so the element factories aren't recreated on
// every render (and each isn't flagged as a nested component definition).
const NOTES_MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => <h3 className="mb-1 mt-2.5 text-xs font-medium first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0 marker:text-brand">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0 marker:text-brand">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children }) => (
    <code className="bg-surface px-1 py-0.5 font-mono text-[0.85em] text-foreground">
      {children}
    </code>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="font-medium text-foreground underline decoration-brand underline-offset-2 hover:text-brand"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-3 border-border" />,
};

/** Release notes rendered from the update's markdown body. Its own module so
 *  the markdown stack loads only when an update is actually on offer. */
export default function ReleaseNotes({ markdown }: { markdown: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={NOTES_MARKDOWN_COMPONENTS}>
      {markdown}
    </ReactMarkdown>
  );
}
