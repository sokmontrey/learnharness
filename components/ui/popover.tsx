"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * The styled popover (footnote-pin wave, owner 2026-11): click-to-open,
 * click-outside/Escape to close (Radix default dismiss — no hand-rolled
 * listener needed). Unlike the tooltip chip (hover, instant, single line)
 * this carries markdown/LaTeX-bearing prose, so it's a bounded card, not a
 * one-liner: bg-popover, a real border, capped width, scrolls internally
 * if content runs long.
 */

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
	return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
	return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
	className,
	sideOffset = 6,
	children,
	...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Content
				data-slot="popover-content"
				sideOffset={sideOffset}
				className={cn(
					"z-50 max-h-[min(60vh,20rem)] w-[min(24rem,80vw)] origin-(--radix-popover-content-transform-origin) animate-in overflow-y-auto rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-md fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
					className
				)}
				{...props}
			>
				{children}
			</PopoverPrimitive.Content>
		</PopoverPrimitive.Portal>
	)
}

export { Popover, PopoverTrigger, PopoverContent }
