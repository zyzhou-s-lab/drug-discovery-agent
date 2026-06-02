import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from '@/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger

export const DialogContent = React.forwardRef<
    HTMLDivElement,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        {/* grid-centering wrapper: robust against ancestor transforms/filters that would
            capture a `fixed`+translate-centered panel and push it off-center. The wrapper
            is pointer-events-none so backdrop clicks still reach the Overlay (Radix dismiss);
            the panel itself re-enables pointer events. */}
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center overflow-y-auto p-3">
            <DialogPrimitive.Content
                ref={ref}
                className={cn(
                    'pointer-events-auto relative w-full max-w-lg rounded-xl bg-[var(--app-dialog-bg)] p-4 shadow-2xl',
                    className
                )}
                {...props}
            />
        </div>
    </DialogPrimitive.Portal>
))
DialogContent.displayName = 'DialogContent'

export const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)} {...props} />
)

export const DialogTitle = React.forwardRef<
    HTMLHeadingElement,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Title
        ref={ref}
        className={cn('text-base font-semibold leading-none tracking-tight', className)}
        {...props}
    />
))
DialogTitle.displayName = 'DialogTitle'

export const DialogDescription = React.forwardRef<
    HTMLParagraphElement,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Description
        ref={ref}
        className={cn('text-sm text-[var(--app-hint)]', className)}
        {...props}
    />
))
DialogDescription.displayName = 'DialogDescription'
