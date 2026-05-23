import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, localDateInputValue, startOfIsoWeekMonday } from "./dates";
import type { LocationDto, ShiftSlot } from "./types";

const API = "/api";
const H_START = 7;
const H_END = 23;
const HOURS = H_END - H_START;
const DAYS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const TYPE_LABEL: Record<ShiftSlot["courier_type"], string> = {
  teal: "Пеший",
  blue: "Вело",
  amber: "Авто",
  purple: "Мото",
};
const TYPE_STYLES: Record<ShiftSlot["courier_type"], { bg: string; border: string; text: string }> = {
  teal: { bg: "#9FE1CB", border: "#5DCAA5", text: "#085041" },
  blue: { bg: "#B5D4F4", border: "#85B7EB", text: "#0C447C" },
  amber: { bg: "#FAC775", border: "#EF9F27", text: "#633806" },
  purple: { bg: "#CECBF6", border: "#AFA9EC", text: "#3C3489" },
};

type PlannerSlot = {
  id: string;
  location_id: string;
  date: string;
  start: string;
  end: string;
  count: number;
  type: ShiftSlot["courier_type"];
  booked_count: number;
  closed_by_admin: boolean;
};

type ModalSlot = Partial<PlannerSlot> & Pick<PlannerSlot, "date" | "start" | "end" | "count" | "type">;

type Props = {
  accessToken: string;
  locations: LocationDto[];
  onUnauthorized: () => void;
};

function adminHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
}

async function readApiError(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as { detail?: unknown; message?: string };
    if (typeof j.message === "string") return j.message;
    if (typeof j.detail === "string") return j.detail;
    if (Array.isArray(j.detail)) return j.detail.map((x: { msg?: string }) => x.msg ?? JSON.stringify(x)).join("; ");
    if (j.detail && typeof j.detail === "object") return JSON.stringify(j.detail);
  } catch {
    /* ignore */
  }
  return r.statusText;
}

function fmtDate(d: Date) {
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

function isToday(d: Date) {
  const n = new Date();
  return d.getDate() === n.getDate() && d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatHm(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function timeToMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minToTime(m: number) {
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

function fracToX(min: number) {
  return ((min - H_START * 60) / (HOURS * 60)) * 100;
}

function toPlannerSlot(slot: ShiftSlot): PlannerSlot {
  const start = new Date(slot.starts_at);
  const end = new Date(slot.ends_at);
  return {
    id: slot.id,
    location_id: slot.location_id,
    date: localDateInputValue(start),
    start: formatHm(start),
    end: formatHm(end),
    count: slot.capacity,
    type: slot.courier_type ?? "teal",
    booked_count: slot.booked_count,
    closed_by_admin: slot.closed_by_admin,
  };
}

function Modal({
  slot,
  weekDates,
  onSave,
  onDelete,
  onClose,
}: {
  slot: ModalSlot;
  weekDates: Date[];
  onSave: (slot: Pick<PlannerSlot, "date" | "start" | "end" | "count" | "type">) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(slot.date);
  const [start, setStart] = useState(slot.start);
  const [end, setEnd] = useState(slot.end);
  const [count, setCount] = useState(slot.count);
  const [type, setType] = useState(slot.type);
  const [error, setError] = useState("");

  function handleSave() {
    if (start >= end) {
      setError("Время конца должно быть позже начала");
      return;
    }
    onSave({ date, start, end, count: Math.max(1, Number.parseInt(String(count)) || 1), type });
  }

  const inp = {
    width: "100%",
    padding: "7px 10px",
    fontSize: 13,
    border: "1px solid #d1d5db",
    borderRadius: 8,
    background: "#fff",
    color: "#111827",
    outline: "none",
    fontFamily: "inherit",
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 14,
          padding: "22px 24px",
          width: 340,
          maxWidth: "92vw",
          boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{slot.id ? "Редактировать слот" : "Новый слот"}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#9ca3af", lineHeight: 1 }}>
            x
          </button>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 4 }}>День</label>
          <select style={inp} value={date} onChange={(e) => setDate(e.target.value)}>
            {weekDates.map((d, i) => (
              <option key={i} value={localDateInputValue(d)}>
                {DAYS_RU[i]} {fmtDate(d)}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: "#6b7280", display: "block" }}>
            Начало
            <input style={{ ...inp, marginTop: 4 }} type="time" step="900" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label style={{ fontSize: 11, color: "#6b7280", display: "block" }}>
            Конец
            <input style={{ ...inp, marginTop: 4 }} type="time" step="900" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: "#6b7280", display: "block" }}>
            Курьеров
            <input style={{ ...inp, marginTop: 4 }} type="number" min="1" max="40" value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </label>
          <label style={{ fontSize: 11, color: "#6b7280", display: "block" }}>
            Тип
            <select style={{ ...inp, marginTop: 4 }} value={type} onChange={(e) => setType(e.target.value as ShiftSlot["courier_type"])}>
              {Object.entries(TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>

        {slot.booked_count ? (
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>Уже записано: {slot.booked_count}. Удаление такого слота недоступно.</div>
        ) : null}
        {error && <div style={{ fontSize: 12, color: "#dc2626", marginBottom: 10 }}>{error}</div>}

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18 }}>
          {slot.id && (
            <button
              onClick={() => onDelete(slot.id!)}
              disabled={Boolean(slot.booked_count)}
              style={{
                padding: "7px 14px",
                border: "1px solid #fca5a5",
                borderRadius: 8,
                background: "#fff",
                color: "#dc2626",
                fontSize: 12,
                cursor: slot.booked_count ? "not-allowed" : "pointer",
                fontFamily: "inherit",
              }}
            >
              Удалить
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ padding: "7px 14px", border: "1px solid #d1d5db", borderRadius: 8, background: "#fff", color: "#374151", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
            Отмена
          </button>
          <button onClick={handleSave} style={{ padding: "7px 18px", background: "#1D9E75", border: "none", borderRadius: 8, color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

function NowMarker() {
  const [pct, setPct] = useState<number | null>(null);
  useEffect(() => {
    function calc() {
      const now = new Date();
      const m = now.getHours() * 60 + now.getMinutes();
      setPct(m >= H_START * 60 && m <= H_END * 60 ? fracToX(m) : null);
    }
    calc();
    const t = window.setInterval(calc, 60000);
    return () => window.clearInterval(t);
  }, []);
  if (pct === null) return null;
  return (
    <div style={{ position: "absolute", top: 0, bottom: 0, left: `${pct}%`, width: 1.5, background: "#E24B4A", zIndex: 10, pointerEvents: "none" }}>
      <div style={{ position: "absolute", top: 0, left: -3, width: 7, height: 7, borderRadius: "50%", background: "#E24B4A" }} />
    </div>
  );
}

function DayRow({
  date,
  daySlots,
  isToday: today,
  onSlotClick,
  onAreaClick,
}: {
  date: Date;
  daySlots: PlannerSlot[];
  isToday: boolean;
  onSlotClick: (slot: PlannerSlot) => void;
  onAreaClick: (dateKey: string, start: string, end: string) => void;
}) {
  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const totalMin = H_START * 60 + Math.round((frac * HOURS * 60) / 15) * 15;
    const cs = Math.max(H_START * 60, Math.min(H_END * 60 - 60, totalMin));
    onAreaClick(localDateInputValue(date), minToTime(cs), minToTime(cs + 120));
  }

  return (
    <div style={{ position: "relative", height: 44, cursor: "crosshair", borderBottom: "0.5px solid #f0f0f0" }} onClick={handleClick}>
      {Array.from({ length: HOURS + 1 }, (_, i) => (
        <div key={i} style={{ position: "absolute", top: 0, bottom: 0, left: `${(i / HOURS) * 100}%`, width: "0.5px", background: i % 2 === 0 ? "#e5e7eb" : "#f3f4f6", pointerEvents: "none" }} />
      ))}

      {today && <NowMarker />}

      {daySlots.map((s) => {
        const left = fracToX(timeToMin(s.start));
        const right = fracToX(timeToMin(s.end));
        const width = Math.max(right - left, 1.5);
        const st = TYPE_STYLES[s.type] || TYPE_STYLES.teal;
        return (
          <div
            key={s.id}
            title={`${s.start}-${s.end} · ${s.booked_count}/${s.count}`}
            onClick={(e) => {
              e.stopPropagation();
              onSlotClick(s);
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.8")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            style={{
              position: "absolute",
              top: 5,
              height: 34,
              left: `${left}%`,
              width: `${width}%`,
              background: s.closed_by_admin ? "#e5e7eb" : st.bg,
              border: `1px solid ${s.closed_by_admin ? "#cbd5e1" : st.border}`,
              borderRadius: 6,
              padding: "0 8px",
              display: "flex",
              alignItems: "center",
              fontSize: 11,
              fontWeight: 500,
              color: s.closed_by_admin ? "#64748b" : st.text,
              cursor: "pointer",
              overflow: "hidden",
              whiteSpace: "nowrap",
              transition: "opacity 0.15s",
              zIndex: 2,
              boxSizing: "border-box",
            }}
          >
            {TYPE_LABEL[s.type]}
            <span style={{ opacity: 0.8, marginLeft: 4 }}>
              {s.booked_count}/{s.count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function CourierSlotPlanner({ accessToken, locations, onUnauthorized }: Props) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [slots, setSlots] = useState<PlannerSlot[]>([]);
  const [modal, setModal] = useState<{ slot: ModalSlot } | null>(null);
  const [locationId, setLocationId] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const weekMonday = useMemo(() => addDays(startOfIsoWeekMonday(new Date()), weekOffset * 7), [weekOffset]);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekMonday, i)), [weekMonday]);
  const weekKeys = useMemo(() => new Set(weekDates.map(localDateInputValue)), [weekDates]);
  const weekSlots = slots.filter((s) => weekKeys.has(s.date));

  useEffect(() => {
    if (!locationId && locations.length) setLocationId(locations[0].id);
  }, [locationId, locations]);

  const loadSlots = useCallback(async () => {
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const from = new Date(weekMonday);
      from.setHours(0, 0, 0, 0);
      const to = addDays(from, 7);
      const q = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
      if (locationId) q.set("location_id", locationId);
      const r = await fetch(`${API}/admin/shift-instances?${q}`, { headers: adminHeaders(accessToken) });
      if (r.status === 401) {
        onUnauthorized();
        throw new Error("Сессия недействительна или истекла. Войдите снова.");
      }
      if (!r.ok) throw new Error(await readApiError(r));
      const data = (await r.json()) as ShiftSlot[];
      setSlots(data.map(toPlannerSlot));
    } catch (e) {
      setSlots([]);
      setError(e instanceof Error ? e.message : "Ошибка загрузки слотов");
    } finally {
      setLoading(false);
    }
  }, [accessToken, locationId, onUnauthorized, weekMonday]);

  useEffect(() => {
    if (accessToken && locationId) void loadSlots();
  }, [accessToken, locationId, loadSlots]);

  function openNew(dateKey: string, start = "09:00", end = "13:00") {
    setModal({ slot: { date: dateKey, start, end, count: 5, type: "teal" } });
  }

  function openEdit(slot: PlannerSlot) {
    setModal({ slot });
  }

  async function handleSave({ date, start, end, count, type }: Pick<PlannerSlot, "date" | "start" | "end" | "count" | "type">) {
    if (!locationId) {
      setError("Сначала создайте и выберите локацию.");
      return;
    }
    const body = {
      location_id: modal?.slot.location_id ?? locationId,
      starts_at: new Date(`${date}T${start}:00`).toISOString(),
      ends_at: new Date(`${date}T${end}:00`).toISOString(),
      capacity: count,
      courier_type: type,
    };
    try {
      const isEdit = Boolean(modal?.slot.id);
      const url = isEdit ? `${API}/admin/shift-instances/${modal!.slot.id}` : `${API}/admin/shift-instances`;
      const r = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: adminHeaders(accessToken),
        body: JSON.stringify(body),
      });
      if (r.status === 401) {
        onUnauthorized();
        throw new Error("Сессия недействительна или истекла. Войдите снова.");
      }
      if (!r.ok) throw new Error(await readApiError(r));
      setModal(null);
      setMessage(isEdit ? "Слот обновлён." : "Слот создан.");
      await loadSlots();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить слот");
    }
  }

  async function handleDelete(id: string) {
    try {
      const r = await fetch(`${API}/admin/shift-instances/${id}`, {
        method: "DELETE",
        headers: adminHeaders(accessToken),
      });
      if (r.status === 401) {
        onUnauthorized();
        throw new Error("Сессия недействительна или истекла. Войдите снова.");
      }
      if (!r.ok) throw new Error(await readApiError(r));
      setModal(null);
      setMessage("Слот удалён.");
      await loadSlots();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить слот");
    }
  }

  const peak = (() => {
    let p = 0;
    for (let t = H_START * 60; t < H_END * 60; t += 15) {
      let cur = 0;
      weekSlots.forEach((s) => {
        if (t >= timeToMin(s.start) && t < timeToMin(s.end)) cur += s.count;
      });
      if (cur > p) p = cur;
    }
    return p;
  })();
  const totalHours = Math.round(weekSlots.reduce((a, s) => a + ((timeToMin(s.end) - timeToMin(s.start)) / 60) * s.count, 0));
  const avgCount = weekSlots.length ? Math.round(weekSlots.reduce((a, s) => a + s.count, 0) / weekSlots.length) : 0;
  const DAY_LABEL_W = 72;

  return (
    <div style={{ fontFamily: "'Inter','Segoe UI',system-ui,sans-serif", padding: "20px 24px", background: "#f8f9fa", color: "#111827", border: "1px solid #e5e7eb", borderRadius: 16 }}>
      {modal && <Modal slot={modal.slot} weekDates={weekDates} onSave={(s) => void handleSave(s)} onDelete={(id) => void handleDelete(id)} onClose={() => setModal(null)} />}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={() => setWeekOffset((o) => o - 1)} style={btnStyle}>
            {"<"}
          </button>
          <span style={{ fontSize: 14, fontWeight: 500, minWidth: 148, textAlign: "center" }}>
            {fmtDate(weekDates[0])} - {fmtDate(weekDates[6])}
          </span>
          <button onClick={() => setWeekOffset((o) => o + 1)} style={btnStyle}>
            {">"}
          </button>
        </div>
        <button onClick={() => setWeekOffset(0)} style={{ ...btnStyle, width: "auto", padding: "5px 14px", fontSize: 13 }}>
          Сегодня
        </button>
        <select value={locationId} onChange={(e) => setLocationId(e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #d1d5db", minWidth: 180 }}>
          {!locations.length ? <option value="">Нет локаций</option> : null}
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <button onClick={() => void loadSlots()} disabled={loading || !locationId} style={{ ...btnStyle, width: "auto", padding: "5px 14px", fontSize: 13 }}>
          {loading ? "Загрузка..." : "Обновить"}
        </button>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {Object.entries(TYPE_STYLES).map(([k, st]) => (
            <span key={k} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#6b7280" }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: st.bg, border: `1px solid ${st.border}`, display: "inline-block" }} />
              {TYPE_LABEL[k as ShiftSlot["courier_type"]]}
            </span>
          ))}
        </div>
        <button
          onClick={() => openNew(localDateInputValue(weekDates[0]))}
          disabled={!locationId}
          style={{ padding: "7px 16px", background: "#1D9E75", border: "none", borderRadius: 8, color: "#fff", fontSize: 13, fontWeight: 500, cursor: locationId ? "pointer" : "not-allowed", fontFamily: "inherit" }}
        >
          + Добавить слот
        </button>
      </div>

      {message ? <p style={{ color: "#15803d", marginTop: 0 }}>{message}</p> : null}
      {error ? <p style={{ color: "#b91c1c", marginTop: 0 }}>{error}</p> : null}
      {!locations.length ? <p style={{ color: "#71717a" }}>Создайте локацию ниже, чтобы начать редактировать расписание.</p> : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 16 }}>
        {[
          ["Слотов на неделе", weekSlots.length],
          ["Курьеро-часов", totalHours],
          ["Пик одновременно", peak],
          ["Среднее в слоте", avgCount],
        ].map(([l, v]) => (
          <div key={l} style={{ background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 10, padding: "10px 14px" }}>
            <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 3 }}>{l}</div>
            <div style={{ fontSize: 22, fontWeight: 600 }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ display: "flex", borderBottom: "0.5px solid #e5e7eb", background: "#f9fafb" }}>
          <div style={{ width: DAY_LABEL_W, flexShrink: 0 }} />
          <div style={{ flex: 1, position: "relative", height: 26 }}>
            {Array.from({ length: HOURS + 1 }, (_, i) => (
              <span key={i} style={{ position: "absolute", left: `${(i / HOURS) * 100}%`, transform: "translateX(-50%)", fontSize: 10, color: "#9ca3af", top: 6, whiteSpace: "nowrap" }}>
                {pad2(H_START + i)}:00
              </span>
            ))}
          </div>
        </div>

        {weekDates.map((d, i) => {
          const dateKey = localDateInputValue(d);
          const today = isToday(d);
          return (
            <div key={i} style={{ display: "flex", borderBottom: i < 6 ? "0.5px solid #f0f0f0" : "none" }}>
              <div style={{ width: DAY_LABEL_W, flexShrink: 0, padding: "10px 10px", borderRight: "0.5px solid #e5e7eb", background: "#fafafa" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: today ? "#1D9E75" : "#374151" }}>{DAYS_RU[i]}</div>
                <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{fmtDate(d)}</div>
              </div>
              <div style={{ flex: 1, padding: 0, position: "relative" }}>
                <DayRow date={d} daySlots={slots.filter((s) => s.date === dateKey)} isToday={today} onSlotClick={openEdit} onAreaClick={openNew} />
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 10, fontSize: 11, color: "#9ca3af", textAlign: "right" }}>* нажмите на слот для редактирования · нажмите на пустое место для добавления</div>
    </div>
  );
}

const btnStyle = {
  width: 32,
  height: 32,
  border: "0.5px solid #d1d5db",
  borderRadius: 8,
  background: "#fff",
  cursor: "pointer",
  fontSize: 18,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#374151",
  fontFamily: "inherit",
};
