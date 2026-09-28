import { fireEvent, render, screen, act } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import enMessages from "@/i18n/messages/en.json"
import {
  PinMessageButton,
  PinnedMessagesProvider,
  PinnedMessagesRail,
  resetPinnedMessagesForTests,
} from "./pinned-messages"

const items = [
  { kind: "turn", group: { id: "u1" } },
  { kind: "turn", group: { id: "a1" } },
  { kind: "divider" },
  { kind: "turn", group: { id: "u2" } },
]

function Harness({
  scrollToIndex = vi.fn(),
}: {
  scrollToIndex?: ReturnType<typeof vi.fn>
}) {
  const scrollApiRef = { current: { scrollToIndex } }
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PinnedMessagesProvider conversationId={7}>
        <PinMessageButton
          messageId="a1"
          text={"  The   report is ready\n at x.html "}
          variant="reply"
        />
        <PinMessageButton
          messageId="u2"
          text="Second question"
          variant="user"
        />
        <PinnedMessagesRail
          conversationId={7}
          items={items}
          scrollApiRef={scrollApiRef}
        />
      </PinnedMessagesProvider>
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  localStorage.clear()
  resetPinnedMessagesForTests()
})

describe("pinned messages", () => {
  it("pins and unpins from the button, showing a rail bar per pin", () => {
    render(<Harness />)
    expect(screen.queryByTestId("pinned-messages-rail")).toBeNull()

    fireEvent.click(screen.getAllByRole("button", { name: "Pin message" })[0])
    const rail = screen.getByTestId("pinned-messages-rail")
    expect(rail.querySelectorAll("button")).toHaveLength(1)
    expect(
      screen.getByRole("button", { name: "Unpin message" })
    ).toHaveAttribute("aria-pressed", "true")
    // Label is whitespace-collapsed.
    expect(
      JSON.parse(localStorage.getItem("codeg:pinned-messages:7")!)[0]
    ).toMatchObject({
      id: "a1",
      label: "The report is ready at x.html",
    })

    fireEvent.click(screen.getByRole("button", { name: "Unpin message" }))
    expect(screen.queryByTestId("pinned-messages-rail")).toBeNull()
    expect(localStorage.getItem("codeg:pinned-messages:7")).toBeNull()
  })

  it("keeps pins across remounts and orders bars by transcript position", () => {
    localStorage.setItem(
      "codeg:pinned-messages:7",
      JSON.stringify([
        { id: "u2", label: "Second question", pinnedAt: 2 },
        { id: "a1", label: "The report", pinnedAt: 1 },
        { id: "gone", label: "Not loaded", pinnedAt: 3 },
      ])
    )
    render(<Harness />)
    const bars = screen
      .getByTestId("pinned-messages-rail")
      .querySelectorAll("button")
    // "gone" is not in the loaded transcript, so it is not drawn.
    expect([...bars].map((b) => b.getAttribute("aria-label"))).toEqual([
      "The report",
      "Second question",
    ])
  })

  it("jumps to the pinned message when its bar is clicked", () => {
    localStorage.setItem(
      "codeg:pinned-messages:7",
      JSON.stringify([{ id: "u2", label: "Second question", pinnedAt: 1 }])
    )
    const scrollToIndex = vi.fn()
    render(<Harness scrollToIndex={scrollToIndex} />)
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Second question" }))
    })
    expect(scrollToIndex).toHaveBeenCalledWith(3, {
      align: "start",
      smooth: true,
    })
  })

  it("renders no pin button outside a conversation", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <PinMessageButton messageId="x" text="x" variant="reply" />
      </NextIntlClientProvider>
    )
    expect(screen.queryByRole("button")).toBeNull()
  })
})
