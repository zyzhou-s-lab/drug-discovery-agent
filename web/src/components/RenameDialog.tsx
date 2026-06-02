import { useState } from 'react'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ddaApi } from '@/api/dda'

// Shared rename dialog (HAPI RenameSessionDialog pattern): autofocus input + Save.
export function RenameDialog(props: {
    target: { campaign: string; current: string } | null
    onClose: () => void
    onDone: () => void
}) {
    const [name, setName] = useState('')
    const [seen, setSeen] = useState<string | null>(null)
    const open = props.target != null
    if (open && seen !== props.target!.campaign) {
        setSeen(props.target!.campaign)
        setName(props.target!.current)
    }
    const save = async () => {
        const t = name.trim()
        if (!t || !props.target) return
        await ddaApi.rename(props.target.campaign, t)
        props.onDone()
        props.onClose()
    }
    return (
        <Dialog open={open} onOpenChange={(o) => !o && props.onClose()}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>重命名</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-3">
                    <input
                        autoFocus
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && save()}
                        className="rounded-md border border-[var(--app-border)] bg-transparent px-2 py-1.5 text-sm outline-none focus:border-[var(--app-button)]"
                    />
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={props.onClose}>取消</Button>
                        <Button size="sm" onClick={save}>保存</Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
