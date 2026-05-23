import { useCallback, useEffect, useMemo, useState } from "react";
import CourierSlotPlanner from "./CourierSlotPlanner";
import type { CourierDto, LocationDto, ShiftTemplateDto } from "./types";
import { localDateInputValue } from "./dates";

const API = "/api";

const ADMIN_JWT_KEY = "courier_admin_jwt";
const LEGACY_ADMIN_TOKEN_KEY = "courier_admin_token";

const TZ_PRESETS = ["Europe/Moscow", "Europe/Kaliningrad", "Asia/Yekaterinburg", "UTC"];

const WEEKDAYS = [
  { v: 0, label: "Понедельник" },
  { v: 1, label: "Вторник" },
  { v: 2, label: "Среда" },
  { v: 3, label: "Четверг" },
  { v: 4, label: "Пятница" },
  { v: 5, label: "Суббота" },
  { v: 6, label: "Воскресенье" },
];

function adminHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
}

async function readApiError(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as { detail?: unknown };
    const d = j.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d))
      return d.map((x: { msg?: string }) => x.msg ?? JSON.stringify(x)).join("; ");
    if (d && typeof d === "object") return JSON.stringify(d);
  } catch {
    /* ignore */
  }
  return r.statusText;
}

type AdminScheduleProps = {
  /** После успешной генерации недели — синхронизировать вкладку «Календарь» с этой неделей. */
  onWeekGenerated?: (weekMondayYmd: string) => void;
};

export default function AdminSchedule({ onWeekGenerated }: AdminScheduleProps) {
  const [token, setToken] = useState("");
  const [loginUser, setLoginUser] = useState("admin");
  const [loginPass, setLoginPass] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [displayName, setDisplayName] = useState("");

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [templates, setTemplates] = useState<ShiftTemplateDto[]>([]);
  const [couriers, setCouriers] = useState<CourierDto[]>([]);

  const [locName, setLocName] = useState("Склад №1");
  const [locTz, setLocTz] = useState("Europe/Moscow");

  const [tplLocationId, setTplLocationId] = useState("");
  const [tplDow, setTplDow] = useState(0);
  const [tplStart, setTplStart] = useState("09:00");
  const [tplDuration, setTplDuration] = useState(480);
  const [tplCapacity, setTplCapacity] = useState(4);

  const [weekDate, setWeekDate] = useState(() => localDateInputValue());

  const [cCourierId, setCCourierId] = useState("");
  const [cLocIds, setCLocIds] = useState("");

  const persistToken = useCallback((t: string) => {
    setToken(t);
    sessionStorage.setItem(ADMIN_JWT_KEY, t);
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(ADMIN_JWT_KEY);
    sessionStorage.removeItem(LEGACY_ADMIN_TOKEN_KEY);
    setToken("");
    setDisplayName("");
    setLocations([]);
    setTemplates([]);
    setCouriers([]);
    setMsg(null);
    setErr(null);
  }, []);

  const refreshLists = useCallback(
    async (overrideAccessToken?: string) => {
      const raw = (overrideAccessToken ?? token).trim();
      setErr(null);
      setMsg(null);
      if (!raw) {
        setLocations([]);
        setTemplates([]);
        setCouriers([]);
        return;
      }
      try {
        const h = adminHeaders(raw);
        const [lr, tr, cr] = await Promise.all([
          fetch(`${API}/admin/locations`, { headers: h }),
          fetch(`${API}/admin/shift-templates`, { headers: h }),
          fetch(`${API}/admin/couriers`, { headers: h }),
        ]);
        if (lr.status === 401 || tr.status === 401 || cr.status === 401) {
          logout();
          setErr("Сессия недействительна или истекла. Войдите снова.");
          return;
        }
        if (!lr.ok) throw new Error(await readApiError(lr));
        if (!tr.ok) throw new Error(await readApiError(tr));
        if (!cr.ok) throw new Error(await readApiError(cr));
        setLocations(await lr.json());
        setTemplates(await tr.json());
        setCouriers(await cr.json());
        setMsg("Списки обновлены.");
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Ошибка загрузки админки");
      }
    },
    [token, logout],
  );

  useEffect(() => {
    sessionStorage.removeItem(LEGACY_ADMIN_TOKEN_KEY);
    const saved = sessionStorage.getItem(ADMIN_JWT_KEY);
    if (!saved) return;
    void (async () => {
      const r = await fetch(`${API}/auth/admin/me`, { headers: { Authorization: `Bearer ${saved}` } });
      if (!r.ok) {
        sessionStorage.removeItem(ADMIN_JWT_KEY);
        return;
      }
      const j = (await r.json()) as { username?: string };
      setToken(saved);
      setDisplayName(j.username ?? "");
      setLoginUser(j.username ?? "admin");
    })();
  }, []);

  useEffect(() => {
    void refreshLists();
  }, [refreshLists]);

  useEffect(() => {
    if (!tplLocationId && locations.length) {
      setTplLocationId(locations[0].id);
    }
  }, [locations, tplLocationId]);

  const explain = useMemo(
    () =>
      [
        "Здесь задаётся расписание для экрана курьера.",
        "Войдите логином и паролем администратора (значения задаются в Docker: ADMIN_USERNAME и ADMIN_PASSWORD).",
        "После входа вы получаете JWT — его браузер сохраняет до выхода или истечения срока.",
      ].join(" "),
    [],
  );

  const doLogin = async () => {
    setErr(null);
    setMsg(null);
    setLoginBusy(true);
    try {
      const r = await fetch(`${API}/auth/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: loginUser.trim(), password: loginPass }),
      });
      if (!r.ok) throw new Error(await readApiError(r));
      const data = (await r.json()) as { access_token: string };
      persistToken(data.access_token);
      setLoginPass("");
      const mr = await fetch(`${API}/auth/admin/me`, {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });
      if (mr.ok) {
        const mj = (await mr.json()) as { username?: string };
        setDisplayName(mj.username ?? loginUser.trim());
      }
      setMsg("Вход выполнен.");
      await refreshLists(data.access_token);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка входа");
    } finally {
      setLoginBusy(false);
    }
  };

  const createLocation = async () => {
    setErr(null);
    setMsg(null);
    try {
      const r = await fetch(`${API}/admin/locations`, {
        method: "POST",
        headers: adminHeaders(token.trim()),
        body: JSON.stringify({ name: locName.trim(), timezone: locTz }),
      });
      if (!r.ok) throw new Error(await readApiError(r));
      const j = await r.json();
      setMsg(`Локация создана: ${j.id}`);
      await refreshLists();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const createTemplate = async () => {
    setErr(null);
    setMsg(null);
    if (!tplLocationId) {
      setErr("Выберите локацию.");
      return;
    }
    try {
      const r = await fetch(`${API}/admin/shift-templates`, {
        method: "POST",
        headers: adminHeaders(token.trim()),
        body: JSON.stringify({
          location_id: tplLocationId,
          day_of_week: tplDow,
          start_time: tplStart,
          duration_minutes: tplDuration,
          capacity: tplCapacity,
        }),
      });
      if (!r.ok) throw new Error(await readApiError(r));
      const j = await r.json();
      setMsg(`Шаблон создан: ${j.id}`);
      await refreshLists();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const generateWeek = async () => {
    setErr(null);
    setMsg(null);
    try {
      const week_start = new Date(`${weekDate}T12:00:00`).toISOString();
      const r = await fetch(`${API}/admin/shifts/generate-week`, {
        method: "POST",
        headers: adminHeaders(token.trim()),
        body: JSON.stringify({ week_start }),
      });
      if (!r.ok) throw new Error(await readApiError(r));
      const j = await r.json();
      const wm = typeof j.week_monday === "string" ? j.week_monday : "";
      if (wm) onWeekGenerated?.(wm);
      setMsg(`Сгенерировано слотов: ${j.created_instance_ids?.length ?? 0}. Неделя с ${wm || "?"}`);
      await refreshLists();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const createCourier = async () => {
    setErr(null);
    setMsg(null);
    try {
      const ids = cLocIds
        .split(/[\s,;]+/)
        .map((x) => x.trim())
        .filter(Boolean);
      const r = await fetch(`${API}/admin/couriers`, {
        method: "POST",
        headers: adminHeaders(token.trim()),
        body: JSON.stringify({
          external_ref: cCourierId.trim() || null,
          location_ids: ids,
        }),
      });
      if (!r.ok) throw new Error(await readApiError(r));
      const j = await r.json();
      setMsg(`Курьер создан. Скопируй UUID для поля X-Courier-Id: ${j.id}`);
      await refreshLists();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    }
  };

  return (
    <div>
      {!token ? (
        <>
          <h2 style={{ marginTop: 0 }}>Редактор расписания</h2>
          <p style={{ color: "#52525b", fontSize: "0.95rem", lineHeight: 1.5 }}>{explain}</p>
        </>
      ) : (
        <CourierSlotPlanner accessToken={token.trim()} locations={locations} onUnauthorized={logout} />
      )}

      <section
        style={{
          marginTop: token ? "1rem" : 0,
          marginBottom: "1rem",
          padding: "1rem",
          background: "#fff",
          borderRadius: 12,
          border: "1px solid #e4e4e7",
        }}
      >
        <h3 style={{ marginTop: 0 }}>Вход администратора</h3>
        {!token ? (
          <>
            <p style={{ marginTop: 0, color: "#52525b", fontSize: "0.9rem" }}>
              По умолчанию в Docker: логин <code>admin</code>, пароль <code>dev-password-change-me</code> (переопределите{" "}
              <code>ADMIN_PASSWORD</code> в compose).
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label>
                Логин
                <input
                  style={{ display: "block", marginTop: 4, padding: "0.45rem 0.6rem", minWidth: 160 }}
                  autoComplete="username"
                  value={loginUser}
                  onChange={(e) => setLoginUser(e.target.value)}
                />
              </label>
              <label>
                Пароль
                <input
                  style={{ display: "block", marginTop: 4, padding: "0.45rem 0.6rem", minWidth: 160 }}
                  type="password"
                  autoComplete="current-password"
                  value={loginPass}
                  onChange={(e) => setLoginPass(e.target.value)}
                />
              </label>
              <button type="button" disabled={loginBusy} onClick={() => void doLogin()}>
                {loginBusy ? "Вход…" : "Войти"}
              </button>
            </div>
          </>
        ) : (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <span>
              Вы вошли как <strong>{displayName || "admin"}</strong>
            </span>
            <button type="button" onClick={() => void refreshLists()}>
              Обновить списки
            </button>
            <button type="button" onClick={logout}>
              Выйти
            </button>
          </div>
        )}
      </section>

      {msg ? (
        <p style={{ color: "#15803d", marginTop: "0.75rem" }} role="status">
          {msg}
        </p>
      ) : null}
      {err ? (
        <p style={{ color: "#b91c1c", marginTop: "0.75rem" }} role="alert">
          {err}
        </p>
      ) : null}

      {!token ? (
        <p style={{ color: "#71717a", marginTop: "1rem" }}>Войдите, чтобы создавать локации, шаблоны и курьеров.</p>
      ) : (
        <>
          <h3 style={{ marginTop: "1.5rem" }}>Дополнительно</h3>
          <section style={{ marginTop: "1.25rem", padding: "1rem", background: "#fff", borderRadius: 12, border: "1px solid #e4e4e7" }}>
            <h3 style={{ marginTop: 0 }}>1. Локация</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input value={locName} onChange={(e) => setLocName(e.target.value)} placeholder="Название" />
              <select value={locTz} onChange={(e) => setLocTz(e.target.value)}>
                {TZ_PRESETS.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => void createLocation()}>
                Создать локацию
              </button>
            </div>
            {locations.length ? (
              <ul style={{ marginBottom: 0 }}>
                {locations.map((l) => (
                  <li key={l.id}>
                    <code>{l.id}</code> — {l.name} ({l.timezone})
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ color: "#71717a" }}>Пока нет локаций.</p>
            )}
          </section>

          <section style={{ marginTop: "1rem", padding: "1rem", background: "#fff", borderRadius: 12, border: "1px solid #e4e4e7" }}>
            <h3 style={{ marginTop: 0 }}>2. Шаблон смены (повтор)</h3>
            <p style={{ marginTop: 0, color: "#52525b", fontSize: "0.9rem" }}>
              Время начала и длительность задают интервал одной смены. Поле «мест на слот» — сколько курьеров может записаться на один и тот же интервал.
            </p>
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
              <label>
                Локация
                <select style={{ display: "block", width: "100%", marginTop: 4 }} value={tplLocationId} onChange={(e) => setTplLocationId(e.target.value)}>
                  <option value="">—</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                День недели
                <select style={{ display: "block", width: "100%", marginTop: 4 }} value={tplDow} onChange={(e) => setTplDow(Number(e.target.value))}>
                  {WEEKDAYS.map((d) => (
                    <option key={d.v} value={d.v}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Начало (местное время локации в шаблоне*)
                <input style={{ display: "block", width: "100%", marginTop: 4 }} type="time" value={tplStart} onChange={(e) => setTplStart(e.target.value)} />
              </label>
              <label>
                Длительность (мин)
                <input
                  style={{ display: "block", width: "100%", marginTop: 4 }}
                  type="number"
                  min={30}
                  step={30}
                  value={tplDuration}
                  onChange={(e) => setTplDuration(Number(e.target.value))}
                />
              </label>
              <label>
                Человек на слот
                <input
                  style={{ display: "block", width: "100%", marginTop: 4 }}
                  type="number"
                  min={1}
                  value={tplCapacity}
                  onChange={(e) => setTplCapacity(Number(e.target.value))}
                />
              </label>
            </div>
            <p style={{ fontSize: "0.82rem", color: "#71717a", marginBottom: 8 }}>
              *Фактическое время слота считается в часовом поясе локации при генерации недели.
            </p>
            <button type="button" onClick={() => void createTemplate()}>
              Сохранить шаблон
            </button>
            {templates.length ? (
              <ul style={{ marginTop: "0.75rem", marginBottom: 0 }}>
                {templates.map((t) => {
                  const loc = locations.find((l) => l.id === t.location_id);
                  return (
                    <li key={t.id}>
                      {loc?.name ?? "локация"} · {WEEKDAYS[t.day_of_week]?.label ?? t.day_of_week} · с {t.start_time.slice(0, 5)} ·{" "}
                      {t.duration_minutes} мин · мест: {t.capacity}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>

          <section style={{ marginTop: "1rem", padding: "1rem", background: "#fff", borderRadius: 12, border: "1px solid #e4e4e7" }}>
            <h3 style={{ marginTop: 0 }}>3. Сгенерировать слоты на неделю</h3>
            <p style={{ marginTop: 0, color: "#52525b", fontSize: "0.9rem" }}>
              Укажите любую дату нужной недели — система возьмёт понедельник этой недели и создаст экземпляры смен по всем активным шаблонам (без дубликатов).
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input type="date" value={weekDate} onChange={(e) => setWeekDate(e.target.value)} />
              <button type="button" onClick={() => void generateWeek()}>
                Сгенерировать
              </button>
            </div>
          </section>

          <section style={{ marginTop: "1rem", padding: "1rem", background: "#fff", borderRadius: 12, border: "1px solid #e4e4e7" }}>
            <h3 style={{ marginTop: 0 }}>Курьер для теста</h3>
            <p style={{ marginTop: 0, color: "#52525b", fontSize: "0.9rem" }}>
              Создайте курьера и привяжите UUID локаций через запятую (из списка выше).
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input placeholder="метка (необязательно)" value={cCourierId} onChange={(e) => setCCourierId(e.target.value)} />
              <input
                style={{ flex: "1 1 280px" }}
                placeholder="uuid локаций через запятую"
                value={cLocIds}
                onChange={(e) => setCLocIds(e.target.value)}
              />
              <button type="button" onClick={() => void createCourier()}>
                Создать курьера
              </button>
            </div>
            {couriers.length ? (
              <ul style={{ marginTop: "0.75rem", marginBottom: 0 }}>
                {couriers.map((c) => (
                  <li key={c.id}>
                    <code>{c.id}</code> — {c.status}
                    {c.external_ref ? ` (${c.external_ref})` : ""} · локаций: {c.location_ids.length}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
