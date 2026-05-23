import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, localDateInputValue, startOfIsoWeekMonday } from "./dates";
import type { AssignmentDto, CourierDto, ShiftSlot } from "./types";

const API = "/api";
const DAYS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WEEK_COUNT = 4;
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

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatHm(value: string) {
  const d = new Date(value);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatDate(d: Date) {
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`;
}

function courierHeaders(courierId: string): HeadersInit {
  return { "Content-Type": "application/json", "X-Courier-Id": courierId };
}

async function readApiError(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as { detail?: unknown; message?: string };
    if (typeof j.message === "string") return j.message;
    if (typeof j.detail === "string") return j.detail;
    if (Array.isArray(j.detail)) return j.detail.map((x: { msg?: string }) => x.msg ?? JSON.stringify(x)).join("; ");
  } catch {
    /* ignore */
  }
  return r.statusText;
}

function storedCourier(): CourierDto | null {
  try {
    const raw = window.localStorage.getItem("courier:self");
    return raw ? (JSON.parse(raw) as CourierDto) : null;
  } catch {
    return null;
  }
}

export default function CourierSelfSignup() {
  const [courier, setCourier] = useState<CourierDto | null>(() => storedCourier());
  const [phone, setPhone] = useState("");
  const [periodOffset, setPeriodOffset] = useState(0);
  const [slots, setSlots] = useState<ShiftSlot[]>([]);
  const [assignments, setAssignments] = useState<AssignmentDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const firstMonday = useMemo(() => addDays(startOfIsoWeekMonday(new Date()), periodOffset * WEEK_COUNT * 7), [periodOffset]);
  const weeks = useMemo(
    () =>
      Array.from({ length: WEEK_COUNT }, (_, weekIndex) => {
        const monday = addDays(firstMonday, weekIndex * 7);
        return {
          monday,
          days: Array.from({ length: 7 }, (_, dayIndex) => addDays(monday, dayIndex)),
        };
      }),
    [firstMonday],
  );
  const assignedShiftIds = useMemo(
    () => new Set(assignments.filter((assignment) => assignment.status === "confirmed").map((assignment) => assignment.shift_instance_id)),
    [assignments],
  );
  const assignmentByShiftId = useMemo(() => {
    const map = new Map<string, AssignmentDto>();
    for (const assignment of assignments) {
      if (assignment.status === "confirmed") {
        map.set(assignment.shift_instance_id, assignment);
      }
    }
    return map;
  }, [assignments]);

  const loadSchedule = useCallback(async () => {
    if (!courier) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const from = new Date(firstMonday);
      from.setHours(0, 0, 0, 0);
      const to = addDays(from, WEEK_COUNT * 7);
      const q = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
      const [slotsResponse, assignmentsResponse] = await Promise.all([
        fetch(`${API}/couriers/me/shifts/available?${q}`, { headers: courierHeaders(courier.id) }),
        fetch(`${API}/couriers/me/assignments`, { headers: courierHeaders(courier.id) }),
      ]);
      if (!slotsResponse.ok) throw new Error(await readApiError(slotsResponse));
      if (!assignmentsResponse.ok) throw new Error(await readApiError(assignmentsResponse));
      setSlots(await slotsResponse.json());
      setAssignments(await assignmentsResponse.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить слоты");
    } finally {
      setLoading(false);
    }
  }, [courier, firstMonday]);

  useEffect(() => {
    void loadSchedule();
  }, [loadSchedule]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoginBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API}/couriers/me/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      const data = (await response.json()) as CourierDto;
      window.localStorage.setItem("courier:self", JSON.stringify(data));
      setCourier(data);
      setPhone("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось войти");
    } finally {
      setLoginBusy(false);
    }
  }

  function logout() {
    window.localStorage.removeItem("courier:self");
    setCourier(null);
    setSlots([]);
    setAssignments([]);
  }

  async function bookSlot(slot: ShiftSlot) {
    if (!courier) return;
    if (slot.booked_count >= slot.capacity) {
      setError("В этом слоте нет свободных мест.");
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`${API}/couriers/me/assignments`, {
        method: "POST",
        headers: { ...courierHeaders(courier.id), "Idempotency-Key": `${courier.id}:${slot.id}:${Date.now()}` },
        body: JSON.stringify({ shift_instance_id: slot.id }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      setMessage("Вы записаны на слот.");
      await loadSchedule();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось записаться");
    }
  }

  async function cancelSlot(slot: ShiftSlot) {
    if (!courier) return;
    const assignment = assignmentByShiftId.get(slot.id);
    if (!assignment) return;
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`${API}/couriers/me/assignments/${assignment.id}`, {
        method: "DELETE",
        headers: courierHeaders(courier.id),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      setMessage("Вы отписались от смены.");
      await loadSchedule();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отписаться");
    }
  }

  function handleSlotClick(slot: ShiftSlot) {
    if (assignmentByShiftId.has(slot.id)) {
      void cancelSlot(slot);
      return;
    }
    void bookSlot(slot);
  }

  if (!courier) {
    return (
      <main className="courier-login-page">
        <section className="courier-login-card">
          <img src="/logo-vkusvill-jdun.png" alt="ВкусВилл Ждун" className="courier-login-logo" />
          <h1>Вход курьера</h1>
          <p>Введите номер телефона, который указан в профиле курьера.</p>
          <form onSubmit={(e) => void login(e)} className="courier-login-form">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 999 123-45-67" autoFocus />
            <button type="submit" disabled={loginBusy || !phone.trim()}>
              {loginBusy ? "Входим..." : "Войти"}
            </button>
          </form>
          {error ? <p className="courier-error">{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="courier-self-page">
      <header className="courier-self-header">
        <img src="/logo-vkusvill-jdun.png" alt="ВкусВилл Ждун" />
        <div>
          <strong>{courier.full_name || courier.phone}</strong>
          <span>
            {TYPE_ICON[courier.courier_type]} {TYPE_LABEL[courier.courier_type]} · {courier.phone}
          </span>
        </div>
        <button type="button" onClick={logout}>Выйти</button>
      </header>

      <section className="courier-self-toolbar">
        <button type="button" onClick={() => setPeriodOffset((value) => value - 1)}>{"<"}</button>
        <strong>
          {formatDate(weeks[0].monday)} - {formatDate(addDays(weeks[weeks.length - 1].monday, 6))}
        </strong>
        <button type="button" onClick={() => setPeriodOffset((value) => value + 1)}>{">"}</button>
        <button type="button" onClick={() => setPeriodOffset(0)}>Сегодня</button>
        <button type="button" onClick={() => void loadSchedule()} disabled={loading}>{loading ? "Загрузка..." : "Обновить"}</button>
      </section>

      {message ? <p className="courier-message">{message}</p> : null}
      {error ? <p className="courier-error">{error}</p> : null}

      <section className="courier-weeks-scroll">
        <div className="courier-weeks-grid">
          {weeks.map((week) => (
            <article key={week.monday.toISOString()} className="courier-week-card">
              <h2>
                Неделя <span>{formatDate(week.monday)} - {formatDate(addDays(week.monday, 6))}</span>
              </h2>
              <div className="courier-week-days">
                {week.days.map((day, dayIndex) => {
                  const dateKey = localDateInputValue(day);
                  const daySlots = slots
                    .filter((slot) => localDateInputValue(new Date(slot.starts_at)) === dateKey)
                    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
                  return (
                    <div key={dateKey} className="courier-day-row">
                      <div className="courier-day-label">
                        <strong>{DAYS_RU[dayIndex]}</strong>
                        <span>{formatDate(day)}</span>
                      </div>
                      <div className="courier-day-slots">
                        {daySlots.map((slot) => {
                          const assigned = assignedShiftIds.has(slot.id);
                          const full = slot.booked_count >= slot.capacity && !assigned;
                          const st = TYPE_STYLES[slot.courier_type];
                          return (
                            <button
                              key={slot.id}
                              type="button"
                              className={assigned ? "courier-slot-card courier-slot-card-assigned" : "courier-slot-card"}
                              disabled={full || slot.closed_by_admin}
                              onClick={() => handleSlotClick(slot)}
                              style={{
                                background: assigned ? "#dcfce7" : full ? "#f3f4f6" : st.bg,
                                borderColor: assigned ? "#22c55e" : full ? "#d1d5db" : st.border,
                                color: assigned ? "#166534" : full ? "#6b7280" : st.text,
                              }}
                            >
                              <span>
                                {formatHm(slot.starts_at)}-{formatHm(slot.ends_at)}
                              </span>
                              <span>
                                {TYPE_ICON[slot.courier_type]} {slot.booked_count}/{slot.capacity}
                              </span>
                              {assigned ? <b>Вы записаны · отписаться</b> : null}
                            </button>
                          );
                        })}
                        {!daySlots.length ? <span className="courier-no-slots">нет слотов</span> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
