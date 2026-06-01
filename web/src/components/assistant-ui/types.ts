// Local replacement for `SyntaxHighlighterProps` from `@assistant-ui/react-markdown`.
// The full markdown stack is intentionally NOT part of this Tier-A starter; the
// shiki / mermaid renderers only need the `code` + `language` fields, so we define
// the minimal compatible shape here to avoid pulling in @assistant-ui/react.
export type SyntaxHighlighterProps = {
    code: string
    language?: string
    node?: unknown
    components?: unknown
}
