"use client"

/**
 * Pinned messages (personal feature, kept in one file so upstream upgrades
 * rarely touch it). Pin any user message or reply from its action row; the
 * pins show as a column of short bars on the transcript's left edge — hover
 * a bar for the message's opening words, click it to jump there — the way the
 * Claude app does it.
 *
 * Pins are stored per conversation in localStorage under
 * `codeg:pinned-messages:<conversationId>` as `{ id, label, pinnedAt }[]`,
 * keyed by the message group's id. Pins whose message is not in the loaded
 * part of the transcript (older history not paged in, or an id that changed
 * after a reparse) are simply not drawn.
 */

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react"
import { Pin, PinOff } from "lucide-react"
import { useLocale } from "next-intl"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { MessageScrollContextValue } from "./message-scroll-context"

export interface PinnedMessage {
  id: string
  label: string
  pinnedAt: number
}

const STORAGE_PREFIX = "codeg:pinned-messages:"

// Copy lives here rather than in src/i18n/messages/*.json so upstream edits to
// those files never conflict with this personal patch.
const COPY = {
  en: { pin: "Pin message", unpin: "Unpin message", list: "Pinned messages" },
  zh: { pin: "置顶消息", unpin: "取消置顶", list: "已置顶的消息" },
  "zh-TW": { pin: "釘選訊息", unpin: "取消釘選", list: "已釘選的訊息" },
  ja: {
    pin: "ピン留め",
    unpin: "ピン留めを解除",
    list: "ピン留めしたメッセージ",
  },
} as const

function useCopy() {
  const locale = useLocale()
  if (locale === "zh-TW") return COPY["zh-TW"]
  if (locale.startsWith("zh")) return COPY.zh
  if (locale.startsWith("ja")) return COPY.ja
  return COPY.en
}
const LABEL_MAX = 80
const EMPTY: PinnedMessage[] = []

// ── store ────────────────────────────────────────────────────────────────

const cache = new Map<number, PinnedMessage[]>()
const listeners = new Map<number, Set<() => void>>()

function read(conversationId: number): PinnedMessage[] {
  const hit = cache.get(conversationId)
  if (hit) return hit
  let value: PinnedMessage[] = EMPTY
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + conversationId)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (Array.isArray(parsed)) {
      value = parsed.filter(
        (p): p is PinnedMessage =>
          typeof p?.id === "string" && typeof p?.label === "string"
      )
    }
  } catch {
    // unreadable → no pins
  }
  cache.set(conversationId, value)
  return value
}

function write(conversationId: number, pins: PinnedMessage[]): void {
  cache.set(conversationId, pins)
  try {
    if (pins.length === 0)
      localStorage.removeItem(STORAGE_PREFIX + conversationId)
    else
      localStorage.setItem(
        STORAGE_PREFIX + conversationId,
        JSON.stringify(pins)
      )
  } catch {
    // quota / private mode: the pin still holds for this session
  }
  listeners.get(conversationId)?.forEach((cb) => cb())
}

function subscribe(conversationId: number, cb: () => void): () => void {
  let set = listeners.get(conversationId)
  if (!set) listeners.set(conversationId, (set = new Set()))
  set.add(cb)
  return () => set.delete(cb)
}

/** Tests only. */
export function resetPinnedMessagesForTests(): void {
  cache.clear()
  listeners.clear()
}

export function usePinnedMessages(conversationId: number | null) {
  const pins = useSyncExternalStore(
    useCallback(
      (cb: () => void) =>
        conversationId == null ? () => {} : subscribe(conversationId, cb),
      [conversationId]
    ),
    () => (conversationId == null ? EMPTY : read(conversationId)),
    () => EMPTY
  )
  const toggle = useCallback(
    (id: string, label: string) => {
      if (conversationId == null) return
      const current = read(conversationId)
      write(
        conversationId,
        current.some((p) => p.id === id)
          ? current.filter((p) => p.id !== id)
          : [...current, { id, label: toLabel(label), pinnedAt: Date.now() }]
      )
    },
    [conversationId]
  )
  return { pins, toggle }
}

function toLabel(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > LABEL_MAX ? flat.slice(0, LABEL_MAX - 1) + "…" : flat
}

// ── context (so deep message rows know their conversation) ────────────────

const ConversationIdContext = createContext<number | null>(null)

export function PinnedMessagesProvider({
  conversationId,
  children,
}: {
  conversationId: number
  children: ReactNode
}) {
  return (
    <ConversationIdContext.Provider value={conversationId}>
      {children}
    </ConversationIdContext.Provider>
  )
}

// ── pin button ───────────────────────────────────────────────────────────

/**
 * The pin toggle for one message. `variant="user"` matches the hover-revealed
 * buttons beside a user bubble; `"reply"` matches a reply's action row. A
 * pinned message keeps its (highlighted) pin visible without hovering.
 */
export const PinMessageButton = memo(function PinMessageButton({
  messageId,
  text,
  variant,
}: {
  messageId: string
  text: string
  variant: "user" | "reply"
}) {
  const copy = useCopy()
  const conversationId = useContext(ConversationIdContext)
  const { pins, toggle } = usePinnedMessages(conversationId)
  if (conversationId == null) return null
  const pinned = pins.some((p) => p.id === messageId)
  const label = pinned ? copy.unpin : copy.pin
  const Icon = pinned ? PinOff : Pin
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => toggle(messageId, text)}
            aria-label={label}
            aria-pressed={pinned}
            data-pinned={pinned || undefined}
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              variant === "reply" ? "h-6 w-6" : "h-6 w-6 self-end",
              variant === "user" &&
                !pinned &&
                "opacity-0 transition-opacity group-hover/user-msg:opacity-100",
              pinned && "bg-primary/10 text-primary hover:bg-primary/15"
            )}
          >
            <Icon aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
})

// ── rail ─────────────────────────────────────────────────────────────────

/** A thread row the rail can locate a pin in. */
export interface PinnableThreadItem {
  kind: string
  group?: { id: string }
}

/**
 * The column of bars on the transcript's left edge, one per pin that is in
 * the loaded transcript, in transcript order.
 */
export const PinnedMessagesRail = memo(function PinnedMessagesRail({
  conversationId,
  items,
  scrollApiRef,
}: {
  conversationId: number
  items: readonly PinnableThreadItem[]
  scrollApiRef: RefObject<MessageScrollContextValue | null>
}) {
  const copy = useCopy()
  const { pins } = usePinnedMessages(conversationId)
  const [active, setActive] = useState<string | null>(null)

  const located = useMemo(() => {
    if (pins.length === 0) return []
    const indexById = new Map<string, number>()
    items.forEach((item, index) => {
      if (item.kind === "turn" && item.group)
        indexById.set(item.group.id, index)
    })
    return pins
      .flatMap((pin) => {
        const index = indexById.get(pin.id)
        return index == null ? [] : [{ pin, index }]
      })
      .sort((a, b) => a.index - b.index)
  }, [pins, items])

  if (located.length === 0) return null
  return (
    <TooltipProvider delayDuration={80}>
      <nav
        aria-label={copy.list}
        data-testid="pinned-messages-rail"
        className="absolute start-1.5 top-1/2 z-20 flex max-h-[60%] -translate-y-1/2 flex-col gap-1 overflow-y-auto py-1"
      >
        {located.map(({ pin, index }) => (
          <Tooltip key={pin.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={pin.label || copy.list}
                onClick={() => {
                  setActive(pin.id)
                  scrollApiRef.current?.scrollToIndex(index, {
                    align: "start",
                    smooth: true,
                  })
                }}
                className="group flex h-3 w-7 items-center rounded-sm px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  className={cn(
                    "block h-[3px] rounded-full bg-foreground/35 transition-all duration-150 group-hover:w-5 group-hover:bg-foreground/80",
                    active === pin.id ? "w-5 bg-foreground/80" : "w-3.5"
                  )}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs">
              {pin.label || copy.list}
            </TooltipContent>
          </Tooltip>
        ))}
      </nav>
    </TooltipProvider>
  )
})
