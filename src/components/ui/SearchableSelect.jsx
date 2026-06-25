"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"

/**
 * SearchableSelect — a single, type-to-search dropdown.
 *
 * Unlike the plain <Select> + inner search <Input> pattern, you click the
 * trigger and start typing immediately: the search box is auto-focused, so
 * there is no separate box to hunt for.
 *
 * Props:
 *  - value / onValueChange : controlled selected value (any primitive id)
 *  - options               : [{ value, label, node?, keywords?, disabled? }]
 *                            label  → text shown + used for filtering
 *                            node   → optional rich JSX shown instead of label
 *                            keywords → extra search terms (e.g. SKU, supplier)
 *  - placeholder           : trigger text when nothing is selected
 *  - searchPlaceholder     : search input placeholder
 *  - emptyText             : shown when no option matches
 *  - disabled
 *  - triggerClassName / contentClassName
 *  - shouldFilter          : default true (cmdk filters internally). Set false
 *                            for server-side filtering and feed `options`
 *                            already filtered, using `onSearchChange`.
 *  - onSearchChange        : (query) => void — fires as the user types
 *  - align                 : popover alignment (default "start")
 */
export function SearchableSelect({
  value,
  onValueChange,
  options = [],
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyText = "No results found.",
  disabled = false,
  triggerClassName,
  contentClassName,
  shouldFilter = true,
  onSearchChange,
  align = "start",
}) {
  const [open, setOpen] = React.useState(false)
  const selected = options.find(o => String(o.value) === String(value))

  const close = () => {
    setOpen(false)
    onSearchChange?.("")
  }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) onSearchChange?.("") }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between gap-2 font-normal",
            !selected && "text-muted-foreground",
            triggerClassName
          )}
        >
          <span className="min-w-0 flex-1 truncate text-left">
            {selected ? (selected.node ?? selected.label) : placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className={cn("w-[var(--radix-popover-trigger-width)] min-w-[12rem] p-0", contentClassName)}
      >
        <Command shouldFilter={shouldFilter}>
          <CommandInput placeholder={searchPlaceholder} onValueChange={onSearchChange} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map(opt => (
                <CommandItem
                  key={String(opt.value)}
                  value={String(opt.value)}
                  keywords={[opt.label ?? String(opt.value), ...(opt.keywords || [])]}
                  disabled={opt.disabled}
                  onSelect={() => {
                    onValueChange?.(opt.value)
                    close()
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4 shrink-0",
                      String(opt.value) === String(value) ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{opt.node ?? opt.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export default SearchableSelect
