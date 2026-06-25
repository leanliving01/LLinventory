"use client"

import * as React from "react"
import { Check, ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"

// ---------------------------------------------------------------------------
// Searchable Select — a drop-in replacement for the Radix Select API.
//
// Every <Select> in the app is now a type-to-search combobox: click the
// trigger and start typing immediately (the search box is auto-focused).
// The public component names and props are unchanged, so no call site needs
// to be touched — value / onValueChange / defaultValue / disabled, the
// <SelectValue placeholder>, <SelectItem value> children, and a className on
// <SelectContent> (e.g. z-index overrides) all keep working.
//
// The search box appears once a dropdown has more than SEARCH_MIN options, so
// only binary toggles (Yes/No) stay plain while every other list — warehouses,
// suppliers, products, customers, categories, statuses, … — is searchable.
// ---------------------------------------------------------------------------

const SEARCH_MIN = 2 // show the search box when there are MORE than this many options (3+)

const SelectContext = React.createContext(null)
const useSelectContext = () => React.useContext(SelectContext)

// Flatten any React node into plain text — used to build the search string
// for an item whose label may be rich JSX (mono SKU + name + badges, …).
function nodeToText(node) {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(nodeToText).join(" ")
  if (React.isValidElement(node)) return nodeToText(node.props?.children)
  return ""
}

// Recursively collect every <SelectItem> descendant (through groups, fragments,
// arrays and conditionals) into a flat [{ value, node, disabled }] list.
function collectItems(children, out) {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    if (child.type === SelectItem) {
      out.push({
        value: child.props.value,
        node: child.props.children,
        disabled: !!child.props.disabled,
      })
    } else if (child.props && child.props.children) {
      // SelectGroup / fragment / wrapper — descend.
      collectItems(child.props.children, out)
    }
  })
}

// Pull the items + the <SelectContent> className out of <Select>'s children
// eagerly (without rendering them), so the trigger can show the selected
// label even while the dropdown is closed.
function parseChildren(children) {
  const items = []
  let contentClassName
  const walk = (nodes) => {
    React.Children.forEach(nodes, (child) => {
      if (!React.isValidElement(child)) return
      if (child.type === SelectContent) {
        contentClassName = child.props.className
        collectItems(child.props.children, items)
      } else if (child.props && child.props.children) {
        walk(child.props.children)
      }
    })
  }
  walk(children)
  return { items, contentClassName }
}

function Select({ value, defaultValue, onValueChange, disabled, children }) {
  const [open, setOpen] = React.useState(false)
  const [internalValue, setInternalValue] = React.useState(defaultValue ?? undefined)
  const isControlled = value !== undefined
  const currentValue = isControlled ? value : internalValue

  const { items, contentClassName } = React.useMemo(
    () => parseChildren(children),
    [children]
  )

  const onSelect = React.useCallback(
    (val) => {
      if (!isControlled) setInternalValue(val)
      onValueChange?.(val)
      setOpen(false)
    },
    [isControlled, onValueChange]
  )

  const ctx = React.useMemo(
    () => ({ open, setOpen, currentValue, onSelect, items, contentClassName, disabled }),
    [open, currentValue, onSelect, items, contentClassName, disabled]
  )

  return (
    <SelectContext.Provider value={ctx}>
      <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
        {children}
      </Popover>
    </SelectContext.Provider>
  )
}

// Structural no-ops — kept so existing imports keep working. Their content is
// parsed by <Select>, not rendered here.
const SelectGroup = ({ children }) => <>{children}</>
const SelectScrollUpButton = () => null
const SelectScrollDownButton = () => null
const SelectLabel = () => null
const SelectSeparator = () => null
// <SelectItem> is never rendered to the DOM — <Select> reads its props during
// parsing. Defined as a component so we can identify it by type.
const SelectItem = () => null

const SelectValue = ({ placeholder, children }) => {
  const ctx = useSelectContext()
  const selected = ctx?.items.find(
    (i) => String(i.value) === String(ctx.currentValue)
  )
  if (selected) return <span className="truncate">{selected.node}</span>
  if (children) return <span className="truncate">{children}</span>
  return <span className="truncate text-muted-foreground">{placeholder}</span>
}

const SelectTrigger = React.forwardRef(({ className, children, ...props }, ref) => {
  const ctx = useSelectContext()
  return (
    <PopoverTrigger asChild>
      <button
        ref={ref}
        type="button"
        role="combobox"
        aria-expanded={ctx?.open}
        disabled={ctx?.disabled || props.disabled}
        className={cn(
          "flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
          className
        )}
        {...props}
      >
        <span className="min-w-0 flex-1 truncate text-left">{children}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </button>
    </PopoverTrigger>
  )
})
SelectTrigger.displayName = "SelectTrigger"

const SelectContent = React.forwardRef(({ className, children, position, ...props }, ref) => {
  const ctx = useSelectContext()
  const items = ctx?.items ?? []
  const showSearch = items.length > SEARCH_MIN
  return (
    <PopoverContent
      ref={ref}
      align="start"
      className={cn(
        "z-[100] w-[var(--radix-popover-trigger-width)] min-w-[10rem] p-0",
        className
      )}
      {...props}
    >
      <Command shouldFilter={showSearch}>
        {showSearch && <CommandInput placeholder="Search..." />}
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup>
            {items.map((it, idx) => (
              <CommandItem
                key={`${String(it.value)}-${idx}`}
                value={String(it.value)}
                keywords={[nodeToText(it.node)].filter(Boolean)}
                disabled={it.disabled}
                onSelect={() => ctx.onSelect(it.value)}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4 shrink-0",
                    String(it.value) === String(ctx.currentValue)
                      ? "opacity-100"
                      : "opacity-0"
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{it.node}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  )
})
SelectContent.displayName = "SelectContent"

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
