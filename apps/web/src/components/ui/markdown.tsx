/**
 * 가이드 마크다운 렌더러.
 *
 * `lib/markdown.ts` 가 만든 블록을 그린다. 문서 자체를 화면으로 쓰기 때문에 본문
 * 폭과 줄 간격을 읽기 쉬운 쪽으로 잡고, 표는 좁은 화면에서 가로로만 스크롤한다.
 */
import type { Block, InlineSpan } from "@/lib/markdown";

function Spans({ spans }: { spans: InlineSpan[] }) {
  return (
    <>
      {spans.map((span, index) => {
        if (span.kind === "strong") {
          return (
            <strong key={index} className="font-semibold text-[var(--color-ink-900)]">
              {span.text}
            </strong>
          );
        }
        if (span.kind === "code") {
          return (
            <code
              key={index}
              className="rounded bg-[var(--color-ivory-200)] px-1.5 py-0.5 text-[0.92em] text-[var(--color-ink-800)]"
            >
              {span.text}
            </code>
          );
        }
        return <span key={index}>{span.text}</span>;
      })}
    </>
  );
}

function Table({ block }: { block: Extract<Block, { kind: "table" }> }) {
  return (
    <div className="my-5 overflow-x-auto rounded-xl border border-[var(--surface-border)]">
      <table className="w-full min-w-[420px] border-collapse text-left text-[13px]">
        <thead className="bg-[var(--color-ivory-100)]">
          <tr>
            {block.head.map((cell, index) => (
              <th
                key={index}
                className="px-3.5 py-2.5 font-medium text-[var(--color-ink-700)]"
                scope="col"
              >
                <Spans spans={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-[var(--surface-border)]">
              {row.map((cell, index) => (
                <td key={index} className="px-3.5 py-2.5 leading-relaxed text-[var(--color-ink-700)]">
                  <Spans spans={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Markdown({ blocks }: { blocks: Block[] }) {
  return (
    <div className="text-[14px] leading-relaxed text-[var(--color-ink-700)]">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading": {
            if (block.level === 1) {
              return (
                <h1
                  key={index}
                  className="display mt-2 text-[26px] leading-tight text-[var(--color-ink-900)]"
                >
                  <Spans spans={block.spans} />
                </h1>
              );
            }
            if (block.level === 2) {
              return (
                <h2
                  key={index}
                  className="display mt-9 text-[19px] leading-snug text-[var(--color-ink-900)]"
                >
                  <Spans spans={block.spans} />
                </h2>
              );
            }
            return (
              <h3
                key={index}
                className="mt-6 text-[15px] font-semibold text-[var(--color-ink-800)]"
              >
                <Spans spans={block.spans} />
              </h3>
            );
          }
          case "paragraph":
            return (
              <p key={index} className="mt-3.5">
                <Spans spans={block.spans} />
              </p>
            );
          case "quote":
            return (
              <blockquote
                key={index}
                className="my-5 rounded-xl border-l-2 border-[var(--color-rose-500)] bg-[var(--color-ivory-100)] px-4 py-3.5"
              >
                {block.paragraphs.map((paragraph, paragraphIndex) => (
                  <p key={paragraphIndex} className={paragraphIndex > 0 ? "mt-2.5" : undefined}>
                    <Spans spans={paragraph} />
                  </p>
                ))}
              </blockquote>
            );
          case "list": {
            const items = block.items.map((item, itemIndex) => (
              <li key={itemIndex} className="mt-2 pl-1">
                <Spans spans={item} />
              </li>
            ));
            return block.ordered ? (
              <ol key={index} className="mt-3 list-decimal pl-5">
                {items}
              </ol>
            ) : (
              <ul key={index} className="mt-3 list-disc pl-5">
                {items}
              </ul>
            );
          }
          case "table":
            return <Table key={index} block={block} />;
          case "rule":
            return <hr key={index} className="my-8 border-[var(--surface-border)]" />;
        }
      })}
    </div>
  );
}
