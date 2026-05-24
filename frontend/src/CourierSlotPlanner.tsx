import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, localDateInputValue, startOfIsoWeekMonday } from "./dates";
import type { AssignmentDto, CourierDto, LocationDto, ShiftSlot } from "./types";

const API = "/api";
const H_START = 6;
const H_END = 23;
const HOURS = H_END - H_START;
const DAYS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const TZ_PRESETS = ["Europe/Moscow", "Europe/Kaliningrad", "Asia/Yekaterinburg", "UTC"];
const TYPE_LABEL: Record<ShiftSlot["courier_type"], string> = {
  teal: "Пеший",
  blue: "Вело",
  amber: "Авто",
  purple: "Мото",
};
const TYPE_ICON: Record<ShiftSlot["courier_type"], string> = {
  teal: "🚶",
  blue: "🚲",
  amber: "🚗",
  purple: "🏍️",
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
  adminName: string;
  onUnauthorized: () => void;
  onLogout: () => void;
  onRefreshLocations: () => Promise<LocationDto[]>;
  onCreateLocation: (location: { name: string; timezone: string }) => Promise<LocationDto>;
  notice?: string | null;
  errorNotice?: string | null;
};

type PlannerTab = "slots" | "couriers" | "assignments";

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

function formatDateTime(value: string) {
  const d = new Date(value);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)} ${formatHm(d)}`;
}

function timeToMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minToTime(m: number) {
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

function dateInputToLocalDate(value: string) {
  return new Date(`${value}T00:00:00`);
}

function dateRangeInputValues(from: string, to: string) {
  const start = dateInputToLocalDate(from);
  const end = dateInputToLocalDate(to);
  const dates: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    dates.push(localDateInputValue(d));
  }
  return dates;
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
  assignedCouriers,
  onSave,
  onDelete,
  onClose,
}: {
  slot: ModalSlot;
  weekDates: Date[];
  assignedCouriers: CourierDto[];
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
          width: 400,
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
        {slot.id ? (
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 8 }}>Записанные курьеры</div>
            {assignedCouriers.length ? (
              <div style={{ display: "grid", gap: 6 }}>
                {assignedCouriers.map((courier) => (
                  <div key={courier.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "#4b5563" }}>
                    <strong style={{ color: "#111827" }}>{courier.full_name || courier.phone || courier.id.slice(0, 8)}</strong>
                    <span>{courier.phone}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#9ca3af" }}>Пока никого нет.</div>
            )}
          </div>
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

function CopyWeekModal({
  weekMonday,
  locations,
  selectedLocationId,
  onCopy,
  onClose,
}: {
  weekMonday: Date;
  locations: LocationDto[];
  selectedLocationId: string;
  onCopy: (body: { source_week_start: string; target_week_start: string; location_id: string | null; mode: "skip_existing" | "replace_empty" | "append" }) => Promise<void>;
  onClose: () => void;
}) {
  const [sourceDate, setSourceDate] = useState(localDateInputValue(weekMonday));
  const [targetDate, setTargetDate] = useState(localDateInputValue(addDays(weekMonday, 7)));
  const [locationScope, setLocationScope] = useState<"current" | "all">(selectedLocationId ? "current" : "all");
  const [mode, setMode] = useState<"skip_existing" | "replace_empty" | "append">("skip_existing");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onCopy({
        source_week_start: new Date(`${sourceDate}T00:00:00`).toISOString(),
        target_week_start: new Date(`${targetDate}T00:00:00`).toISOString(),
        location_id: locationScope === "current" ? selectedLocationId : null,
        mode,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось скопировать неделю");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = { padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 9, font: "inherit" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgb(15 23 42 / 0.35)", display: "grid", placeItems: "center", zIndex: 60, padding: 16 }} onClick={onClose}>
      <div style={{ width: "min(520px, 100%)", background: "#fff", borderRadius: 18, padding: 20, boxShadow: "0 24px 80px rgb(15 23 42 / 0.25)" }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: "0 0 14px", fontSize: 22 }}>Копировать неделю</h2>
        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 5, fontSize: 12, color: "#6b7280" }}>
            Откуда
            <input type="date" value={sourceDate} onChange={(e) => setSourceDate(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 5, fontSize: 12, color: "#6b7280" }}>
            Куда
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 5, fontSize: 12, color: "#6b7280" }}>
            Локации
            <select value={locationScope} onChange={(e) => setLocationScope(e.target.value as "current" | "all")} style={inputStyle}>
              <option value="current">Текущая: {locations.find((location) => location.id === selectedLocationId)?.name ?? "не выбрана"}</option>
              <option value="all">Все локации</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 5, fontSize: 12, color: "#6b7280" }}>
            Конфликты
            <select value={mode} onChange={(e) => setMode(e.target.value as "skip_existing" | "replace_empty" | "append")} style={inputStyle}>
              <option value="skip_existing">Пропустить существующие</option>
              <option value="replace_empty">Заменить пустые слоты недели</option>
              <option value="append">Добавить рядом</option>
            </select>
          </label>
        </div>
        {error ? <p style={{ color: "#b91c1c", marginBottom: 0 }}>{error}</p> : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
          <button type="button" onClick={onClose} style={{ ...smallButtonStyle, width: "auto", padding: "8px 14px", fontSize: 13 }}>Отмена</button>
          <button type="button" onClick={() => void submit()} disabled={busy} style={{ padding: "8px 16px", border: "none", borderRadius: 10, background: busy ? "#9ca3af" : "#1D9E75", color: "#fff", fontWeight: 700 }}>
            {busy ? "Копируем..." : "Копировать"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CopyDayModal({
  sourceDate,
  sourceSlots,
  onCopy,
  onClose,
}: {
  sourceDate: string;
  sourceSlots: PlannerSlot[];
  onCopy: (body: { sourceDate: string; targetStart: string; targetEnd: string; types: ShiftSlot["courier_type"][] }) => Promise<void>;
  onClose: () => void;
}) {
  const sourceDateObject = dateInputToLocalDate(sourceDate);
  const defaultTarget = localDateInputValue(addDays(sourceDateObject, 1));
  const [targetStart, setTargetStart] = useState(defaultTarget);
  const [targetEnd, setTargetEnd] = useState(defaultTarget);
  const [types, setTypes] = useState<ShiftSlot["courier_type"][]>(["teal", "blue", "amber", "purple"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (dateInputToLocalDate(targetEnd) < dateInputToLocalDate(targetStart)) {
        throw new Error("Дата окончания должна быть не раньше даты начала");
      }
      if (!types.length) {
        throw new Error("Выберите хотя бы один тип слотов");
      }
      await onCopy({ sourceDate, targetStart, targetEnd, types });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось скопировать слоты");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = { padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 9, font: "inherit" };
  const selectedCount = sourceSlots.filter((slot) => types.includes(slot.type)).length;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgb(15 23 42 / 0.35)", display: "grid", placeItems: "center", zIndex: 60, padding: 16 }} onClick={onClose}>
      <div style={{ width: "min(520px, 100%)", background: "#fff", borderRadius: 18, padding: 20, boxShadow: "0 24px 80px rgb(15 23 42 / 0.25)" }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: "0 0 6px", fontSize: 22 }}>Копировать день</h2>
        <p style={{ margin: "0 0 14px", color: "#6b7280", fontSize: 13 }}>
          Источник: {fmtDate(sourceDateObject)} · выбрано слотов: {selectedCount}
        </p>
        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 5, fontSize: 12, color: "#6b7280" }}>
            Копировать с
            <input type="date" value={targetStart} onChange={(e) => setTargetStart(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 5, fontSize: 12, color: "#6b7280" }}>
            Копировать по
            <input type="date" value={targetEnd} onChange={(e) => setTargetEnd(e.target.value)} style={inputStyle} />
          </label>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Типы слотов</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {Object.entries(TYPE_LABEL).map(([value, label]) => {
                const type = value as ShiftSlot["courier_type"];
                const checked = types.includes(type);
                return (
                  <label key={value} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 9px", border: "1px solid #e5e7eb", borderRadius: 999, background: checked ? "#eefbf5" : "#fff", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setTypes((prev) => (e.target.checked ? [...prev, type] : prev.filter((item) => item !== type)))
                      }
                    />
                    {TYPE_ICON[type]} {label}
                  </label>
                );
              })}
            </div>
          </div>
        </div>
        {error ? <p style={{ color: "#b91c1c", marginBottom: 0 }}>{error}</p> : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
          <button type="button" onClick={onClose} style={{ ...smallButtonStyle, width: "auto", padding: "8px 14px", fontSize: 13 }}>Отмена</button>
          <button type="button" onClick={() => void submit()} disabled={busy} style={{ padding: "8px 16px", border: "none", borderRadius: 10, background: busy ? "#9ca3af" : "#1D9E75", color: "#fff", fontWeight: 700 }}>
            {busy ? "Копируем..." : "Копировать"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LocationsModal({
  locations,
  selectedLocationId,
  onSelect,
  onCreate,
  onRefresh,
  onClose,
}: {
  locations: LocationDto[];
  selectedLocationId: string;
  onSelect: (id: string) => void;
  onCreate: (location: { name: string; timezone: string }) => Promise<LocationDto>;
  onRefresh: () => Promise<LocationDto[]>;
  onClose: () => void;
}) {
  const [name, setName] = useState("Склад №1");
  const [timezone, setTimezone] = useState("Europe/Moscow");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Введите название локации.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await onCreate({ name: trimmed, timezone });
      onSelect(created.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать локацию");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #d1d5db",
    borderRadius: 10,
    fontSize: 14,
    outline: "none",
    background: "#fff",
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.42)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(100%, 560px)",
          maxHeight: "90vh",
          overflow: "auto",
          background: "#fff",
          borderRadius: 18,
          padding: 24,
          boxShadow: "0 24px 80px rgba(15, 23, 42, 0.24)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22 }}>Локации</h2>
            <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 13 }}>Выберите склад или добавьте новый.</p>
          </div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={() => void onRefresh()} style={{ ...smallButtonStyle, width: "auto", padding: "7px 12px", fontSize: 13 }}>
            Обновить
          </button>
          <button type="button" onClick={onClose} style={{ ...smallButtonStyle, width: 32, height: 32, fontSize: 16 }}>
            x
          </button>
        </div>

        <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
          {locations.length ? (
            locations.map((location) => {
              const selected = location.id === selectedLocationId;
              return (
                <button
                  key={location.id}
                  type="button"
                  onClick={() => {
                    onSelect(location.id);
                    onClose();
                  }}
                  style={{
                    textAlign: "left",
                    border: `1px solid ${selected ? "#1D9E75" : "#e5e7eb"}`,
                    background: selected ? "#eefbf5" : "#fff",
                    borderRadius: 12,
                    padding: "12px 14px",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <strong style={{ color: "#111827" }}>{location.name}</strong>
                    {selected ? <span style={{ color: "#1D9E75", fontSize: 12, fontWeight: 700 }}>выбрана</span> : null}
                  </div>
                  <div style={{ color: "#6b7280", fontSize: 12, marginTop: 3 }}>{location.timezone}</div>
                </button>
              );
            })
          ) : (
            <div style={{ padding: 14, borderRadius: 12, background: "#f9fafb", color: "#6b7280" }}>Локаций пока нет.</div>
          )}
        </div>

        <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 18 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Добавить локацию</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 190px", gap: 10 }}>
            <label style={{ fontSize: 12, color: "#6b7280", display: "grid", gap: 5 }}>
              Название
              <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Склад №2" />
            </label>
            <label style={{ fontSize: 12, color: "#6b7280", display: "grid", gap: 5 }}>
              Часовой пояс
              <select style={inputStyle} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {TZ_PRESETS.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error ? <div style={{ color: "#b91c1c", fontSize: 13, marginTop: 10 }}>{error}</div> : null}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button type="button" onClick={onClose} style={{ ...smallButtonStyle, width: "auto", padding: "8px 14px", fontSize: 13 }}>
              Отмена
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleCreate()}
              style={{
                border: "none",
                borderRadius: 10,
                background: "#1D9E75",
                color: "#fff",
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 700,
                cursor: busy ? "wait" : "pointer",
              }}
            >
              {busy ? "Создаём..." : "Создать"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CourierManager({
  accessToken,
  locations,
}: {
  accessToken: string;
  locations: LocationDto[];
}) {
  const [couriers, setCouriers] = useState<CourierDto[]>([]);
  const [assignments, setAssignments] = useState<AssignmentDto[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCourier, setEditingCourier] = useState<CourierDto | null>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [courierType, setCourierType] = useState<ShiftSlot["courier_type"]>("teal");
  const [locationIds, setLocationIds] = useState<string[]>(locations.map((location) => location.id));
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingCourier, setSavingCourier] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [couriersResponse, assignmentsResponse] = await Promise.all([
        fetch(`${API}/admin/couriers`, { headers: adminHeaders(accessToken) }),
        fetch(`${API}/admin/assignments`, { headers: adminHeaders(accessToken) }),
      ]);
      if (!couriersResponse.ok) throw new Error(await readApiError(couriersResponse));
      if (!assignmentsResponse.ok) throw new Error(await readApiError(assignmentsResponse));
      setCouriers(await couriersResponse.json());
      setAssignments(await assignmentsResponse.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки курьеров");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function openCreateCourier() {
    setEditingCourier(null);
    setFullName("");
    setPhone("");
    setCourierType("teal");
    setLocationIds(locations.map((location) => location.id));
    setModalOpen(true);
  }

  function openEditCourier(courier: CourierDto) {
    setEditingCourier(courier);
    setFullName(courier.full_name);
    setPhone(courier.phone ?? courier.external_ref ?? "");
    setCourierType(courier.courier_type);
    setLocationIds(courier.location_ids);
    setModalOpen(true);
  }

  function closeCourierModal() {
    setModalOpen(false);
    setEditingCourier(null);
  }

  async function saveCourier() {
    setError(null);
    setMessage(null);
    if (!fullName.trim() || !phone.trim()) {
      setError("Заполните ФИО и телефон");
      return;
    }
    setSavingCourier(true);
    try {
      const isEdit = Boolean(editingCourier);
      const response = await fetch(isEdit ? `${API}/admin/couriers/${editingCourier!.id}` : `${API}/admin/couriers`, {
        method: isEdit ? "PUT" : "POST",
        headers: adminHeaders(accessToken),
        body: JSON.stringify({
          full_name: fullName.trim(),
          phone: phone.trim(),
          courier_type: courierType,
          location_ids: locationIds,
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      setFullName("");
      setPhone("");
      setCourierType("teal");
      setLocationIds(locations.map((location) => location.id));
      closeCourierModal();
      setMessage(isEdit ? "Курьер обновлён." : "Курьер добавлен.");
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить курьера");
    } finally {
      setSavingCourier(false);
    }
  }

  async function setCourierStatus(courier: CourierDto, status: "active" | "blocked") {
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`${API}/admin/couriers/${courier.id}/status`, {
        method: "PATCH",
        headers: adminHeaders(accessToken),
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      setMessage(status === "blocked" ? "Курьер заблокирован." : "Курьер разблокирован.");
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось изменить статус курьера");
    }
  }

  const assignmentsByCourier = useMemo(() => {
    const map = new Map<string, AssignmentDto[]>();
    for (const assignment of assignments) {
      const list = map.get(assignment.courier_id) ?? [];
      list.push(assignment);
      map.set(assignment.courier_id, list);
    }
    return map;
  }, [assignments]);

  const filteredCouriers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return couriers;
    return couriers.filter((courier) =>
      `${courier.full_name} ${courier.phone ?? ""} ${courier.external_ref ?? ""}`.toLowerCase().includes(needle),
    );
  }, [couriers, query]);

  return (
    <section style={{ display: "grid", gap: 16 }}>
      {modalOpen ? (
        <div style={{ position: "fixed", inset: 0, background: "rgb(15 23 42 / 0.35)", display: "grid", placeItems: "center", zIndex: 50, padding: 16 }}>
          <div style={{ width: "min(560px, 100%)", background: "#fff", borderRadius: 18, padding: 20, boxShadow: "0 24px 80px rgb(15 23 42 / 0.25)" }}>
            <h2 style={{ margin: "0 0 14px", fontSize: 22 }}>{editingCourier ? "Редактировать курьера" : "Новый курьер"}</h2>
            <div style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 5, fontSize: 12, color: "#6b7280" }}>
                ФИО
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Иванов Иван Иванович" style={{ padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 10 }} autoFocus />
              </label>
              <label style={{ display: "grid", gap: 5, fontSize: 12, color: "#6b7280" }}>
                Телефон
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 999 123-45-67" style={{ padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 10 }} />
              </label>
              <label style={{ display: "grid", gap: 5, fontSize: 12, color: "#6b7280" }}>
                Тип курьера
                <select value={courierType} onChange={(e) => setCourierType(e.target.value as ShiftSlot["courier_type"])} style={{ padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 10 }}>
                  {Object.entries(TYPE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {locations.map((location) => {
                  const checked = locationIds.includes(location.id);
                  return (
                    <label key={location.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 10px", border: "1px solid #e5e7eb", borderRadius: 999, background: checked ? "#eefbf5" : "#fff", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setLocationIds((prev) =>
                            e.target.checked ? [...prev, location.id] : prev.filter((id) => id !== location.id),
                          )
                        }
                      />
                      {location.name}
                    </label>
                  );
                })}
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
              <button type="button" onClick={closeCourierModal} style={{ ...smallButtonStyle, width: "auto", padding: "9px 14px" }}>Отмена</button>
              <button type="button" disabled={savingCourier} onClick={() => void saveCourier()} style={{ padding: "9px 16px", border: "none", borderRadius: 10, background: savingCourier ? "#9ca3af" : "#1D9E75", color: "#fff", fontWeight: 700 }}>
                {savingCourier ? "Сохраняем..." : editingCourier ? "Сохранить" : "Добавить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="courier-toolbar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по ФИО или телефону"
          style={{ flex: 1, minWidth: 220, padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 10 }}
        />
        <button type="button" onClick={openCreateCourier} style={{ padding: "10px 16px", border: "none", borderRadius: 10, background: "#1D9E75", color: "#fff", fontWeight: 700 }}>
          + Добавить
        </button>
      </div>

      {message ? <p style={{ color: "#15803d", margin: 0 }}>{message}</p> : null}
      {error ? <p style={{ color: "#b91c1c", margin: 0 }}>{error}</p> : null}

      <div className="courier-table-wrap">
        <table className="courier-table">
          <thead>
            <tr>
              <th className="courier-col-location">Локация</th>
              <th className="courier-col-phone">Телефон</th>
              <th className="courier-col-type">Тип</th>
              <th className="courier-col-name">ФИО</th>
              <th className="courier-col-slots">Слоты</th>
              <th className="courier-col-status">Статус</th>
              <th className="courier-col-action" />
            </tr>
          </thead>
          <tbody>
            {filteredCouriers.map((courier) => {
              const courierAssignments = assignmentsByCourier.get(courier.id) ?? [];
              const nextAssignment = courierAssignments[0];
              return (
                <tr key={courier.id}>
                  <td className="courier-col-location">{courier.location_ids.map((id) => locations.find((l) => l.id === id)?.name ?? id.slice(0, 8)).join(", ") || "—"}</td>
                  <td className="courier-col-phone">{courier.phone || courier.external_ref || "—"}</td>
                  <td className="courier-col-type">
                    <span
                      className="courier-type-icon"
                      title={TYPE_LABEL[courier.courier_type] ?? courier.courier_type}
                      style={{
                        background: TYPE_STYLES[courier.courier_type]?.bg ?? "#e5e7eb",
                        borderColor: TYPE_STYLES[courier.courier_type]?.border ?? "#d1d5db",
                        color: TYPE_STYLES[courier.courier_type]?.text ?? "#374151",
                      }}
                    >
                      {TYPE_ICON[courier.courier_type] ?? "•"}
                    </span>
                  </td>
                  <td className="courier-col-name"><strong>{courier.full_name || courier.external_ref || courier.id.slice(0, 8)}</strong></td>
                  <td className="courier-col-slots" title={courierAssignments.map((assignment) => `${formatDateTime(assignment.starts_at)} - ${formatDateTime(assignment.ends_at)}`).join("\n")}>
                    {courierAssignments.length}
                    {nextAssignment ? ` · ${formatDateTime(nextAssignment.starts_at)}` : ""}
                  </td>
                  <td className="courier-col-status">
                    <span className={courier.status === "active" ? "courier-status-active" : "courier-status-blocked"}>
                      {courier.status === "active" ? "активен" : "заблокирован"}
                    </span>
                  </td>
                  <td className="courier-col-action">
                    <div className="courier-row-actions">
                      <button
                        type="button"
                        onClick={() => openEditCourier(courier)}
                        style={{ ...smallButtonStyle, width: "auto", padding: "6px 10px", fontSize: 12 }}
                      >
                        Править
                      </button>
                      <button
                        type="button"
                        onClick={() => void setCourierStatus(courier, courier.status === "active" ? "blocked" : "active")}
                        style={{ ...smallButtonStyle, width: "auto", padding: "6px 10px", fontSize: 12 }}
                      >
                        {courier.status === "active" ? "Блок" : "Вернуть"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {loading ? <p style={{ color: "#6b7280", margin: 12 }}>Загрузка...</p> : null}
        {!loading && filteredCouriers.length === 0 ? <p style={{ color: "#6b7280", margin: 12 }}>Курьеры не найдены.</p> : null}
      </div>
    </section>
  );
}

function AssignmentsManager({
  accessToken,
  locations,
  onUnauthorized,
}: {
  accessToken: string;
  locations: LocationDto[];
  onUnauthorized: () => void;
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [locationId, setLocationId] = useState("");
  const [slots, setSlots] = useState<PlannerSlot[]>([]);
  const [assignments, setAssignments] = useState<AssignmentDto[]>([]);
  const [couriers, setCouriers] = useState<CourierDto[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<PlannerSlot | null>(null);
  const [courierQuery, setCourierQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weekMonday = useMemo(() => addDays(startOfIsoWeekMonday(new Date()), weekOffset * 7), [weekOffset]);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekMonday, i)), [weekMonday]);
  const weekKeys = useMemo(() => new Set(weekDates.map(localDateInputValue)), [weekDates]);
  const weekSlots = slots.filter((s) => weekKeys.has(s.date));
  const confirmedAssignments = assignments.filter((assignment) => assignment.status === "confirmed");

  useEffect(() => {
    if (!locationId && locations.length) setLocationId(locations[0].id);
  }, [locationId, locations]);

  const loadData = useCallback(async () => {
    if (!locationId) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const from = new Date(weekMonday);
      from.setHours(0, 0, 0, 0);
      const to = addDays(from, 7);
      const q = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), location_id: locationId });
      const [slotsResponse, assignmentsResponse, couriersResponse] = await Promise.all([
        fetch(`${API}/admin/shift-instances?${q}`, { headers: adminHeaders(accessToken) }),
        fetch(`${API}/admin/assignments`, { headers: adminHeaders(accessToken) }),
        fetch(`${API}/admin/couriers`, { headers: adminHeaders(accessToken) }),
      ]);
      if (slotsResponse.status === 401 || assignmentsResponse.status === 401 || couriersResponse.status === 401) {
        onUnauthorized();
        throw new Error("Сессия недействительна или истекла. Войдите снова.");
      }
      if (!slotsResponse.ok) throw new Error(await readApiError(slotsResponse));
      if (!assignmentsResponse.ok) throw new Error(await readApiError(assignmentsResponse));
      if (!couriersResponse.ok) throw new Error(await readApiError(couriersResponse));
      setSlots(((await slotsResponse.json()) as ShiftSlot[]).map(toPlannerSlot));
      setAssignments(await assignmentsResponse.json());
      setCouriers(await couriersResponse.json());
    } catch (e) {
      setSlots([]);
      setError(e instanceof Error ? e.message : "Ошибка загрузки назначений");
    } finally {
      setLoading(false);
    }
  }, [accessToken, locationId, onUnauthorized, weekMonday]);

  useEffect(() => {
    if (accessToken && locationId) void loadData();
  }, [loadData]);

  const assignmentsBySlot = useMemo(() => {
    const map = new Map<string, AssignmentDto[]>();
    for (const assignment of confirmedAssignments) {
      const list = map.get(assignment.shift_instance_id) ?? [];
      list.push(assignment);
      map.set(assignment.shift_instance_id, list);
    }
    return map;
  }, [confirmedAssignments]);

  const selectedAssignments = selectedSlot ? assignmentsBySlot.get(selectedSlot.id) ?? [] : [];
  const selectedAssignedCourierIds = new Set(selectedAssignments.map((assignment) => assignment.courier_id));

  const availableCouriers = selectedSlot
    ? couriers.filter((courier) => {
        if (courier.status !== "active") return false;
        if (courier.courier_type !== selectedSlot.type) return false;
        if (!courier.location_ids.includes(selectedSlot.location_id)) return false;
        if (selectedAssignedCourierIds.has(courier.id)) return false;
        const needle = courierQuery.trim().toLowerCase();
        if (needle && !`${courier.full_name} ${courier.phone ?? ""}`.toLowerCase().includes(needle)) return false;
        const slotStart = new Date(`${selectedSlot.date}T${selectedSlot.start}:00`).getTime();
        const slotEnd = new Date(`${selectedSlot.date}T${selectedSlot.end}:00`).getTime();
        return !confirmedAssignments.some((assignment) => {
          if (assignment.courier_id !== courier.id) return false;
          const assignmentStart = new Date(assignment.starts_at).getTime();
          const assignmentEnd = new Date(assignment.ends_at).getTime();
          return assignmentStart < slotEnd && assignmentEnd > slotStart;
        });
      })
    : [];

  async function assignCourier(courierId: string) {
    if (!selectedSlot) return;
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`${API}/admin/assignments`, {
        method: "POST",
        headers: adminHeaders(accessToken),
        body: JSON.stringify({ courier_id: courierId, shift_instance_id: selectedSlot.id }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      setMessage("Курьер назначен.");
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось назначить курьера");
    }
  }

  async function cancelAssignment(assignmentId: string) {
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`${API}/admin/assignments/${assignmentId}`, {
        method: "DELETE",
        headers: adminHeaders(accessToken),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      setMessage("Назначение снято.");
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось снять назначение");
    }
  }

  const DAY_LABEL_W = 72;

  return (
    <section style={{ display: "grid", gap: 16 }}>
      {selectedSlot ? (
        <div style={{ position: "fixed", inset: 0, background: "rgb(15 23 42 / 0.35)", display: "grid", placeItems: "center", zIndex: 50, padding: 16 }} onClick={() => setSelectedSlot(null)}>
          <div style={{ width: "min(720px, 100%)", maxHeight: "88vh", overflow: "auto", background: "#fff", borderRadius: 18, padding: 20, boxShadow: "0 24px 80px rgb(15 23 42 / 0.25)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 22 }}>Назначение курьеров</h2>
                <p style={{ margin: "6px 0 0", color: "#6b7280" }}>
                  {formatDateTime(new Date(`${selectedSlot.date}T${selectedSlot.start}:00`).toISOString())} - {selectedSlot.end} · {TYPE_LABEL[selectedSlot.type]} · {selectedAssignments.length}/{selectedSlot.count}
                </p>
              </div>
              <button type="button" onClick={() => setSelectedSlot(null)} style={{ ...smallButtonStyle, width: "auto", padding: "7px 12px", fontSize: 13 }}>Закрыть</button>
            </div>

            <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
              <section>
                <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>Уже назначены</h3>
                <div style={{ display: "grid", gap: 8 }}>
                  {selectedAssignments.map((assignment) => {
                    const courier = couriers.find((c) => c.id === assignment.courier_id);
                    return (
                      <div key={assignment.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", border: "1px solid #e5e7eb", borderRadius: 10 }}>
                        <strong>{courier?.full_name || courier?.phone || assignment.courier_id.slice(0, 8)}</strong>
                        <span style={{ color: "#6b7280", fontSize: 13 }}>{courier?.phone}</span>
                        <div style={{ flex: 1 }} />
                        <button type="button" onClick={() => void cancelAssignment(assignment.id)} style={{ ...smallButtonStyle, width: "auto", padding: "6px 10px", fontSize: 12 }}>Снять</button>
                      </div>
                    );
                  })}
                  {!selectedAssignments.length ? <p style={{ color: "#6b7280", margin: 0 }}>Пока никого нет.</p> : null}
                </div>
              </section>

              <section>
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
                  <h3 style={{ margin: 0, fontSize: 15 }}>Можно назначить</h3>
                  <input value={courierQuery} onChange={(e) => setCourierQuery(e.target.value)} placeholder="Поиск курьера" style={{ marginLeft: "auto", minWidth: 220, padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 10 }} />
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {availableCouriers.map((courier) => (
                    <div key={courier.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", border: "1px solid #e5e7eb", borderRadius: 10 }}>
                      <span
                        className="courier-type-icon"
                        title={TYPE_LABEL[courier.courier_type]}
                        style={{
                          background: TYPE_STYLES[courier.courier_type].bg,
                          borderColor: TYPE_STYLES[courier.courier_type].border,
                          color: TYPE_STYLES[courier.courier_type].text,
                        }}
                      >
                        {TYPE_ICON[courier.courier_type]}
                      </span>
                      <strong>{courier.full_name || courier.phone}</strong>
                      <span style={{ color: "#6b7280", fontSize: 13 }}>{courier.phone}</span>
                      <div style={{ flex: 1 }} />
                      <button
                        type="button"
                        onClick={() => void assignCourier(courier.id)}
                        disabled={selectedAssignments.length >= selectedSlot.count}
                        style={{ padding: "6px 11px", border: 0, borderRadius: 8, background: selectedAssignments.length >= selectedSlot.count ? "#d1d5db" : "#1D9E75", color: "#fff", fontWeight: 700 }}
                      >
                        Назначить
                      </button>
                    </div>
                  ))}
                  {!availableCouriers.length ? <p style={{ color: "#6b7280", margin: 0 }}>Подходящих курьеров нет.</p> : null}
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={() => setWeekOffset((o) => o - 1)} style={btnStyle}>{"<"}</button>
          <span style={{ fontSize: 14, fontWeight: 500, minWidth: 148, textAlign: "center" }}>
            {fmtDate(weekDates[0])} - {fmtDate(weekDates[6])}
          </span>
          <button onClick={() => setWeekOffset((o) => o + 1)} style={btnStyle}>{">"}</button>
        </div>
        <button onClick={() => setWeekOffset(0)} style={{ ...btnStyle, width: "auto", padding: "5px 14px", fontSize: 13 }}>Сегодня</button>
        <select value={locationId} onChange={(e) => setLocationId(e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #d1d5db", minWidth: 180 }}>
          {!locations.length ? <option value="">Нет локаций</option> : null}
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <button type="button" onClick={() => void loadData()} disabled={loading || !locationId} style={{ ...btnStyle, width: "auto", padding: "5px 14px", fontSize: 13 }}>
          {loading ? "Загрузка..." : "Обновить"}
        </button>
      </div>

      {message ? <p style={{ color: "#15803d", margin: 0 }}>{message}</p> : null}
      {error ? <p style={{ color: "#b91c1c", margin: 0 }}>{error}</p> : null}

      <div className="slot-calendar-scroll">
        <div className="slot-calendar-grid">
          <div style={{ display: "flex", borderBottom: "0.5px solid #e5e7eb", background: "#f9fafb" }}>
            <div className="slot-day-label slot-day-label-header" style={{ width: DAY_LABEL_W, flexShrink: 0 }} />
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
                <div className="slot-day-label" style={{ width: DAY_LABEL_W, flexShrink: 0, padding: "10px 10px", borderRight: "0.5px solid #e5e7eb", background: "#fafafa" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: today ? "#1D9E75" : "#374151" }}>{DAYS_RU[i]}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{fmtDate(d)}</div>
                </div>
                <div className="slot-timeline-cell">
                  <DayRow date={d} daySlots={weekSlots.filter((s) => s.date === dateKey)} isToday={today} onSlotClick={setSelectedSlot} readOnly />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: -6, fontSize: 11, color: "#9ca3af", textAlign: "right" }}>* нажмите на слот, чтобы назначить или снять курьера</div>
    </section>
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
  readOnly = false,
}: {
  date: Date;
  daySlots: PlannerSlot[];
  isToday: boolean;
  onSlotClick: (slot: PlannerSlot) => void;
  onAreaClick?: (dateKey: string, start: string, end: string) => void;
  readOnly?: boolean;
}) {
  const slotHeight = 34;
  const laneGap = 4;
  const verticalPad = 5;
  const lanesEnd: number[] = [];
  const laidOutSlots = [...daySlots]
    .sort((a, b) => timeToMin(a.start) - timeToMin(b.start) || timeToMin(a.end) - timeToMin(b.end))
    .map((slot) => {
      const startMin = timeToMin(slot.start);
      const endMin = timeToMin(slot.end);
      let lane = lanesEnd.findIndex((laneEnd) => laneEnd <= startMin);
      if (lane === -1) {
        lane = lanesEnd.length;
        lanesEnd.push(endMin);
      } else {
        lanesEnd[lane] = endMin;
      }
      return { slot, lane, startMin, endMin };
    });
  const rowHeight = Math.max(44, verticalPad * 2 + lanesEnd.length * slotHeight + Math.max(0, lanesEnd.length - 1) * laneGap);

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (readOnly || !onAreaClick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const totalMin = H_START * 60 + Math.round((frac * HOURS * 60) / 15) * 15;
    const cs = Math.max(H_START * 60, Math.min(H_END * 60 - 60, totalMin));
    onAreaClick(localDateInputValue(date), minToTime(cs), minToTime(cs + 120));
  }

  return (
    <div style={{ position: "relative", height: rowHeight, cursor: readOnly ? "default" : "crosshair", borderBottom: "0.5px solid #f0f0f0" }} onClick={handleClick}>
      {Array.from({ length: HOURS + 1 }, (_, i) => (
        <div key={i} style={{ position: "absolute", top: 0, bottom: 0, left: `${(i / HOURS) * 100}%`, width: "0.5px", background: i % 2 === 0 ? "#e5e7eb" : "#f3f4f6", pointerEvents: "none" }} />
      ))}

      {today && <NowMarker />}

      {laidOutSlots.map(({ slot: s, lane, startMin, endMin }) => {
        const left = fracToX(startMin);
        const right = fracToX(endMin);
        const width = Math.max(right - left, 1.5);
        const st = TYPE_STYLES[s.type] || TYPE_STYLES.teal;
        const full = s.booked_count >= s.count;
        return (
          <div
            key={s.id}
            title={`${s.start}-${s.end} · ${TYPE_LABEL[s.type]} · занято ${s.booked_count}/${s.count}${full ? " · полный" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onSlotClick(s);
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.8")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            style={{
              position: "absolute",
              top: verticalPad + lane * (slotHeight + laneGap),
              height: slotHeight,
              left: `${left}%`,
              width: `${width}%`,
              background: s.closed_by_admin ? "#e5e7eb" : st.bg,
              border: `1px solid ${s.closed_by_admin ? "#cbd5e1" : full ? "#00c853" : st.border}`,
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
            {s.start}-{s.end}
            <span style={{ opacity: 0.8, marginLeft: 4 }}>
              {TYPE_LABEL[s.type]} · {s.booked_count}/{s.count}{full ? " · полный" : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function CourierSlotPlanner({ accessToken, locations, adminName, onUnauthorized, onLogout, onRefreshLocations, onCreateLocation, notice, errorNotice }: Props) {
  const [activeTab, setActiveTab] = useState<PlannerTab>("slots");
  const [weekOffset, setWeekOffset] = useState(0);
  const [slots, setSlots] = useState<PlannerSlot[]>([]);
  const [assignments, setAssignments] = useState<AssignmentDto[]>([]);
  const [couriers, setCouriers] = useState<CourierDto[]>([]);
  const [modal, setModal] = useState<{ slot: ModalSlot } | null>(null);
  const [locationsOpen, setLocationsOpen] = useState(false);
  const [copyWeekOpen, setCopyWeekOpen] = useState(false);
  const [copyDayDate, setCopyDayDate] = useState<string | null>(null);
  const [visibleTypes, setVisibleTypes] = useState<ShiftSlot["courier_type"][]>(["teal", "blue", "amber", "purple"]);
  const [locationId, setLocationId] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const weekMonday = useMemo(() => addDays(startOfIsoWeekMonday(new Date()), weekOffset * 7), [weekOffset]);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekMonday, i)), [weekMonday]);
  const weekKeys = useMemo(() => new Set(weekDates.map(localDateInputValue)), [weekDates]);
  const visibleTypeSet = useMemo(() => new Set(visibleTypes), [visibleTypes]);
  const weekSlots = slots.filter((s) => weekKeys.has(s.date) && visibleTypeSet.has(s.type));

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

  const loadAssignmentContext = useCallback(async () => {
    try {
      const [assignmentsResponse, couriersResponse] = await Promise.all([
        fetch(`${API}/admin/assignments`, { headers: adminHeaders(accessToken) }),
        fetch(`${API}/admin/couriers`, { headers: adminHeaders(accessToken) }),
      ]);
      if (assignmentsResponse.status === 401 || couriersResponse.status === 401) {
        onUnauthorized();
        throw new Error("Сессия недействительна или истекла. Войдите снова.");
      }
      if (!assignmentsResponse.ok) throw new Error(await readApiError(assignmentsResponse));
      if (!couriersResponse.ok) throw new Error(await readApiError(couriersResponse));
      setAssignments(await assignmentsResponse.json());
      setCouriers(await couriersResponse.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить список записанных курьеров");
    }
  }, [accessToken, onUnauthorized]);

  useEffect(() => {
    if (accessToken && locationId) void loadSlots();
  }, [accessToken, locationId, loadSlots]);

  function openNew(dateKey: string, start = "09:00", end = "13:00") {
    setModal({ slot: { date: dateKey, start, end, count: 5, type: "teal" } });
  }

  function openEdit(slot: PlannerSlot) {
    setModal({ slot });
    void loadAssignmentContext();
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

  async function handleCopyWeek(body: { source_week_start: string; target_week_start: string; location_id: string | null; mode: "skip_existing" | "replace_empty" | "append" }) {
    try {
      const r = await fetch(`${API}/admin/shift-instances/copy-week`, {
        method: "POST",
        headers: adminHeaders(accessToken),
        body: JSON.stringify(body),
      });
      if (r.status === 401) {
        onUnauthorized();
        throw new Error("Сессия недействительна или истекла. Войдите снова.");
      }
      if (!r.ok) throw new Error(await readApiError(r));
      const result = (await r.json()) as { created: number; skipped_existing: number; removed_empty: number; kept_booked: number };
      setMessage(`Неделя скопирована: создано ${result.created}, пропущено ${result.skipped_existing}, удалено пустых ${result.removed_empty}, сохранено занятых ${result.kept_booked}.`);
      await loadSlots();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось скопировать неделю");
      throw e;
    }
  }

  async function handleCopyDay(body: { sourceDate: string; targetStart: string; targetEnd: string; types: ShiftSlot["courier_type"][] }) {
    const sourceSlots = slots.filter((slot) => slot.date === body.sourceDate && body.types.includes(slot.type));
    if (!sourceSlots.length) {
      throw new Error("В выбранном дне нет слотов выбранных типов");
    }
    const existingKeys = new Set(slots.map((slot) => `${slot.date}|${slot.location_id}|${slot.start}|${slot.end}|${slot.type}`));
    let created = 0;
    let skipped = 0;

    for (const targetDate of dateRangeInputValues(body.targetStart, body.targetEnd)) {
      if (targetDate === body.sourceDate) {
        skipped += sourceSlots.length;
        continue;
      }
      for (const slot of sourceSlots) {
        const key = `${targetDate}|${slot.location_id}|${slot.start}|${slot.end}|${slot.type}`;
        if (existingKeys.has(key)) {
          skipped += 1;
          continue;
        }
        const r = await fetch(`${API}/admin/shift-instances`, {
          method: "POST",
          headers: adminHeaders(accessToken),
          body: JSON.stringify({
            location_id: slot.location_id,
            starts_at: new Date(`${targetDate}T${slot.start}:00`).toISOString(),
            ends_at: new Date(`${targetDate}T${slot.end}:00`).toISOString(),
            capacity: slot.count,
            courier_type: slot.type,
          }),
        });
        if (r.status === 401) {
          onUnauthorized();
          throw new Error("Сессия недействительна или истекла. Войдите снова.");
        }
        if (!r.ok) throw new Error(await readApiError(r));
        existingKeys.add(key);
        created += 1;
      }
    }
    setMessage(`День скопирован: создано ${created}, пропущено ${skipped}.`);
    await loadSlots();
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
  const modalAssignedCouriers = modal?.slot.id
    ? assignments
        .filter((assignment) => assignment.status === "confirmed" && assignment.shift_instance_id === modal.slot.id)
        .map((assignment) => couriers.find((courier) => courier.id === assignment.courier_id))
        .filter((courier): courier is CourierDto => Boolean(courier))
    : [];
  const DAY_LABEL_W = 72;

  return (
    <div className="slot-planner">
      {modal && <Modal slot={modal.slot} weekDates={weekDates} assignedCouriers={modalAssignedCouriers} onSave={(s) => void handleSave(s)} onDelete={(id) => void handleDelete(id)} onClose={() => setModal(null)} />}
      {copyWeekOpen && <CopyWeekModal weekMonday={weekMonday} locations={locations} selectedLocationId={locationId} onCopy={handleCopyWeek} onClose={() => setCopyWeekOpen(false)} />}
      {copyDayDate && <CopyDayModal sourceDate={copyDayDate} sourceSlots={slots.filter((slot) => slot.date === copyDayDate)} onCopy={handleCopyDay} onClose={() => setCopyDayDate(null)} />}
      {locationsOpen && (
        <LocationsModal
          locations={locations}
          selectedLocationId={locationId}
          onSelect={setLocationId}
          onCreate={onCreateLocation}
          onRefresh={onRefreshLocations}
          onClose={() => setLocationsOpen(false)}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18, flexWrap: "wrap" }}>
        <img src="/logo-vkusvill-jdun.png" alt="ВкусВилл Ждун" style={{ display: "block", width: "clamp(160px, 24vw, 260px)", height: "auto", objectFit: "contain" }} />
        <div className="slot-tabs" role="tablist" aria-label="Разделы">
          {[
            ["slots", "Слоты"],
            ["couriers", "Курьеры"],
            ["assignments", "Назначения"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={activeTab === id ? "slot-tab slot-tab-active" : "slot-tab"}
              onClick={() => setActiveTab(id as PlannerTab)}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ color: "#6b7280", fontSize: 13 }}>admin: {adminName}</span>
        <button type="button" onClick={onLogout} style={{ ...smallButtonStyle, width: "auto", padding: "7px 12px", fontSize: 13 }}>
          Выйти
        </button>
      </div>

      {activeTab === "slots" ? (
        <>
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
        <button onClick={() => setLocationsOpen(true)} style={{ ...smallButtonStyle, width: "auto", padding: "5px 14px", fontSize: 13 }}>
          Локации
        </button>
        <button onClick={() => void loadSlots()} disabled={loading || !locationId} style={{ ...btnStyle, width: "auto", padding: "5px 14px", fontSize: 13 }}>
          {loading ? "Загрузка..." : "Обновить"}
        </button>
        <button onClick={() => setCopyWeekOpen(true)} style={{ ...btnStyle, width: "auto", padding: "5px 14px", fontSize: 13 }}>
          Копировать неделю
        </button>
        <div style={{ flex: 1 }} />
        <div className="slot-type-filters" aria-label="Фильтр типов слотов">
          {Object.entries(TYPE_STYLES).map(([k, st]) => {
            const type = k as ShiftSlot["courier_type"];
            const checked = visibleTypeSet.has(type);
            return (
              <label key={k} className={checked ? "slot-type-filter slot-type-filter-active" : "slot-type-filter"}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    setVisibleTypes((prev) => (e.target.checked ? [...prev, type] : prev.filter((item) => item !== type)));
                  }}
                />
                <span style={{ width: 10, height: 10, borderRadius: 3, background: st.bg, border: `1px solid ${st.border}`, display: "inline-block" }} />
                {TYPE_LABEL[type]}
              </label>
            );
          })}
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
      {notice ? <p style={{ color: "#15803d", marginTop: 0 }}>{notice}</p> : null}
      {error ? <p style={{ color: "#b91c1c", marginTop: 0 }}>{error}</p> : null}
      {errorNotice ? <p style={{ color: "#b91c1c", marginTop: 0 }}>{errorNotice}</p> : null}
      {!locations.length ? <p style={{ color: "#71717a" }}>Создайте локацию через кнопку «Локации», чтобы начать редактировать расписание.</p> : null}

      <div className="slot-stats-grid">
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

      <div className="slot-calendar-scroll">
        <div className="slot-calendar-grid">
        <div style={{ display: "flex", borderBottom: "0.5px solid #e5e7eb", background: "#f9fafb" }}>
          <div className="slot-day-label slot-day-label-header" style={{ width: DAY_LABEL_W, flexShrink: 0 }} />
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
            <div key={i} className="slot-calendar-day-row">
              <div className="slot-day-label" style={{ width: DAY_LABEL_W, flexShrink: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: today ? "#1D9E75" : "#374151" }}>{DAYS_RU[i]}</div>
                <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{fmtDate(d)}</div>
                <button
                  type="button"
                  className="slot-day-copy-button"
                  aria-label="Копировать слоты этого дня"
                  title="Копировать слоты этого дня"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCopyDayDate(dateKey);
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M8 8.5A2.5 2.5 0 0 1 10.5 6h6A2.5 2.5 0 0 1 19 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-6A2.5 2.5 0 0 1 8 16.5v-8Z" />
                    <path d="M5 14.5v-8A2.5 2.5 0 0 1 7.5 4h6" />
                  </svg>
                </button>
              </div>
              <div className="slot-timeline-cell">
                <DayRow date={d} daySlots={weekSlots.filter((s) => s.date === dateKey)} isToday={today} onSlotClick={openEdit} onAreaClick={openNew} />
              </div>
            </div>
          );
        })}
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: 11, color: "#9ca3af", textAlign: "right" }}>* нажмите на слот для редактирования · нажмите на пустое место для добавления</div>
        </>
      ) : activeTab === "couriers" ? (
        <CourierManager accessToken={accessToken} locations={locations} />
      ) : (
        <AssignmentsManager accessToken={accessToken} locations={locations} onUnauthorized={onUnauthorized} />
      )}
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

const smallButtonStyle = {
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
