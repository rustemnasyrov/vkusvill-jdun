import type { ShiftSlot } from "./types";
import { dayColumnDate, isSameLocalDay } from "./dates";

const DAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function pad2(n: number) {
  return n.toString().padStart(2, "0");
}

function formatHm(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function boundsFromSlots(slots: ShiftSlot[], fallbackMin = 8, fallbackMax = 20) {
  let minH = 24;
  let maxH = 0;
  for (const s of slots) {
    const st = new Date(s.starts_at);
    const en = new Date(s.ends_at);
    minH = Math.min(minH, st.getHours() + st.getMinutes() / 60);
    maxH = Math.max(maxH, en.getHours() + en.getMinutes() / 60);
  }
  if (!slots.length) {
    return { minH: fallbackMin, maxH: fallbackMax };
  }
  const minR = Math.max(0, Math.floor(minH) - 1);
  const maxR = Math.min(24, Math.ceil(maxH) + 1);
  return { minH: minR, maxH: maxR };
}

type Props = {
  weekMonday: Date;
  slots: ShiftSlot[];
  onBook?: (slot: ShiftSlot) => void;
  bookingDisabled?: boolean;
};

export default function WeekCalendar({ weekMonday, slots, onBook, bookingDisabled }: Props) {
  const pxPerHour = 44;
  const { minH, maxH } = boundsFromSlots(slots);
  const totalHours = Math.max(1, maxH - minH);
  const gridHeight = totalHours * pxPerHour;

  const slotsByCol = (col: number) => {
    const day = dayColumnDate(weekMonday, col);
    return slots.filter((s) => isSameLocalDay(new Date(s.starts_at), day));
  };

  return (
    <div style={{ overflowX: "auto", marginTop: "1rem" }}>
      <div style={{ display: "flex", gap: "0.35rem", minWidth: 720 }}>
        <div style={{ width: 52, flexShrink: 0 }}>
          <div style={{ height: 36, marginBottom: 4 }} />
          {Array.from({ length: totalHours }, (_, i) => minH + i).map((h) => (
            <div
              key={h}
              style={{
                height: pxPerHour,
                fontSize: "0.72rem",
                color: "#71717a",
                borderTop: "1px solid #e4e4e7",
                paddingTop: 2,
              }}
            >
              {pad2(h)}:00
            </div>
          ))}
        </div>

        {DAY_LABELS.map((label, col) => {
          const day = dayColumnDate(weekMonday, col);
          const daySlots = slotsByCol(col);
          return (
            <div
              key={col}
              style={{
                flex: "1 1 0",
                minWidth: 92,
                border: "1px solid #e4e4e7",
                borderRadius: 10,
                background: "#fafafa",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "8px 6px",
                  fontWeight: 700,
                  fontSize: "0.85rem",
                  borderBottom: "1px solid #e4e4e7",
                  background: "#fff",
                }}
              >
                {label}{" "}
                <span style={{ fontWeight: 500, color: "#71717a" }}>
                  {pad2(day.getDate())}.{pad2(day.getMonth() + 1)}
                </span>
              </div>
              <div style={{ position: "relative", height: gridHeight }}>
                {Array.from({ length: totalHours }, (_, i) => minH + i).map((h) => (
                  <div
                    key={h}
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: (h - minH) * pxPerHour,
                      height: pxPerHour,
                      borderTop: "1px dashed #ececec",
                      pointerEvents: "none",
                    }}
                  />
                ))}
                {daySlots.map((s) => {
                  const st = new Date(s.starts_at);
                  const en = new Date(s.ends_at);
                  const startDec = st.getHours() + st.getMinutes() / 60;
                  const durH = Math.max(0.25, (en.getTime() - st.getTime()) / 3600000);
                  const top = (startDec - minH) * pxPerHour;
                  const height = durH * pxPerHour;
                  const full = s.booked_count >= s.capacity;
                  return (
                    <div
                      key={s.id}
                      title={`${formatHm(st)}–${formatHm(en)} · ${s.booked_count}/${s.capacity}`}
                      style={{
                        position: "absolute",
                        left: 6,
                        right: 6,
                        top,
                        height,
                        borderRadius: 8,
                        padding: "6px 8px",
                        fontSize: "0.72rem",
                        lineHeight: 1.25,
                        background: full ? "#fecaca" : "linear-gradient(180deg,#dbeafe,#bfdbfe)",
                        border: `1px solid ${full ? "#f87171" : "#60a5fa"}`,
                        color: "#1e293b",
                        boxShadow: "0 1px 2px rgb(0 0 0 / 0.06)",
                        overflow: "hidden",
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>
                        {formatHm(st)}–{formatHm(en)}
                      </div>
                      <div style={{ color: "#475569" }}>
                        места: {s.booked_count}/{s.capacity}
                        {s.closed_by_admin ? " · закрыто" : ""}
                      </div>
                      {onBook && !full && !s.closed_by_admin ? (
                        <button
                          type="button"
                          disabled={bookingDisabled}
                          onClick={() => onBook(s)}
                          style={{
                            marginTop: "auto",
                            alignSelf: "flex-start",
                            fontSize: "0.72rem",
                            padding: "4px 8px",
                            cursor: bookingDisabled ? "not-allowed" : "pointer",
                          }}
                        >
                          Записаться
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
