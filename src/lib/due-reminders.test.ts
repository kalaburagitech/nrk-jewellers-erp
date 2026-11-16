import { describe, expect, it } from "vitest";
import { customersToRemind, daysUntilDue, dueStatus } from "./due-reminders";

const now = new Date(2026, 10, 16, 15, 0).getTime();
const day = (offset: number) => new Date(2026, 10, 16 + offset, 9, 0).getTime();

describe("due reminders", () => {
  it("counts whole calendar days", () => {
    expect(daysUntilDue(day(0), now)).toBe(0);
    expect(daysUntilDue(day(2), now)).toBe(2);
    expect(daysUntilDue(day(-1), now)).toBe(-1);
  });

  it("classifies due dates", () => {
    expect(dueStatus(undefined, now)).toBe("no_date");
    expect(dueStatus(day(-1), now)).toBe("overdue");
    expect(dueStatus(day(0), now)).toBe("due_today");
    expect(dueStatus(day(3), now)).toBe("due_soon");
    expect(dueStatus(day(4), now)).toBe("later");
  });

  it("reminds only unpaid balances due soon or overdue, most urgent first", () => {
    const list = customersToRemind(
      [
        { name: "later", outstandingPaise: 100, dueDateMs: day(10) },
        { name: "soon", outstandingPaise: 100, dueDateMs: day(2) },
        { name: "paid", outstandingPaise: 0, dueDateMs: day(-5) },
        { name: "overdue", outstandingPaise: 100, dueDateMs: day(-3) },
        { name: "no date", outstandingPaise: 100 },
      ],
      now,
    );
    expect(list.map((c) => c.name)).toEqual(["overdue", "soon"]);
  });
});
