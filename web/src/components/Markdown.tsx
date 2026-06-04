import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'

// Lightweight markdown for chat answers (headers / bold / lists / code / links / tables).
// Styled via Tailwind arbitrary selectors (no typography plugin needed).
const MD_CLASS =
    'text-sm leading-relaxed ' +
    '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 ' +
    '[&_p]:my-1.5 ' +
    '[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 ' +
    '[&_h1]:mb-1 [&_h1]:mt-2 [&_h1]:text-base [&_h1]:font-semibold ' +
    '[&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:text-[15px] [&_h2]:font-semibold ' +
    '[&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:font-semibold ' +
    '[&_strong]:font-semibold ' +
    '[&_a]:text-[var(--app-link)] [&_a]:underline ' +
    '[&_code]:rounded [&_code]:bg-black/[0.06] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] ' +
    '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-[var(--app-code-bg)] [&_pre]:p-2.5 [&_pre]:text-xs ' +
    '[&_pre_code]:bg-transparent [&_pre_code]:p-0 ' +
    '[&_blockquote]:border-l-2 [&_blockquote]:border-[var(--app-border)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--app-hint)] ' +
    '[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-[var(--app-border)] [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-[var(--app-border)] [&_td]:px-2 [&_td]:py-1 ' +
    // citation superscripts (<sup>n</sup>): larger + colored so they read as references, not tiny glyphs
    '[&_sup]:text-[0.8em] [&_sup]:font-semibold [&_sup]:text-[var(--app-link)] [&_sup]:ml-0.5'

export function Markdown(props: { text: string }) {
    return (
        <div className={MD_CLASS}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
                components={{
                    // open links in a new tab
                    a: ({ node: _node, ...p }) => <a {...p} target="_blank" rel="noreferrer" />,
                }}
            >
                {props.text}
            </ReactMarkdown>
        </div>
    )
}
