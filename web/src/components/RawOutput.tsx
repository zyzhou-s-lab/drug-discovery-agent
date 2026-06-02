import { useState } from 'react'

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { CodeBlock } from '@/components/CodeBlock'

// HAPI scheme for long content: a collapsed CodeBlock preview is non-interactive
// (just a fade + "truncated" hint); the enclosing card is the click target that
// opens a detail dialog with the FULL output. We replicate that here so the
// "打开详情查看完整输出" hint actually opens something.
export function RawOutput(props: { title: string; code: string; language?: string }) {
    const [open, setOpen] = useState(false)
    const lang = props.language ?? 'json'
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <button type="button" className="block w-full cursor-pointer text-left">
                    {/* showCopyButton=false so the preview has no nested <button> inside this trigger button */}
                    <CodeBlock code={props.code} language={lang} title={props.title} collapseLongContent showCopyButton={false} />
                </button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{props.title}</DialogTitle>
                </DialogHeader>
                <div className="max-h-[75vh] overflow-y-auto">
                    <CodeBlock code={props.code} language={lang} scrollY maxHeight={100000} />
                </div>
            </DialogContent>
        </Dialog>
    )
}
