import { useCallback, useMemo, useState } from "react";

const API = "/api";

type ShiftSlot = {
  id: string;
  location_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  booked_count: number;
  closed_by_admin: boolean;
};

function isoRange(days: number) {
  const from = new Date();
  const to = new Date(from.getTime() + days * 86400000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export default function App() {
  const [courierId, setCourierId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slots, setSlots] = useState<ShiftSlot[]>([]);
  const [health, setHealth] = useState<string>("");

  const checkHealth = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`${API}/health`);
      const j = await r.json();
      setHealth(j.status === "ok" ? "API доступен" : JSON.stringify(j));
    } catch (e) {
      setHealth("");
      setError(e instanceof Error ? e.message : "Ошибка /health");
    }
  }, []);

  const loadSlots = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const { from, to } = isoRange(14);
      const q = new URLSearchParams({ from, to });
      const r = await fetch(`${API}/couriers/me/shifts/available?${q}`, {
        headers: { "X-Courier-Id": courierId.trim() },
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error((j as { message?: string }).message ?? r.statusText);
      }
      setSlots(await r.json());
    } catch (e) {
      setSlots([]);
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [courierId]);

  const hint = useMemo(
    () =>
      "Прокси Vite шлёт запросы в контейнер api. Заголовок X-Courier-Id должен совпадать с UUID курьера из админки.",
    [],
  );

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "1.5rem" }}>
      <h1 style={{ marginTop: 0 }}>Смены (dev)</h1>
      <p style={{ color: "#52525b", fontSize: "0.9rem" }}>{hint}</p>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <button type="button" onClick={checkHealth}>
          Проверить API
        </button>
        {health ? <span style={{ alignSelf: "center" }}>{health}</span> : null}
      </div>

      <label style={{ display: "block", marginBottom: "0.35rem", fontWeight: 600 }}>X-Courier-Id</label>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <input
          style={{ flex: "1 1 280px", padding: "0.5rem 0.65rem" }}
          placeholder="uuid курьера"
          value={courierId}
          onChange={(e) => setCourierId(e.target.value)}
        />
        <button type="button" disabled={loading || !courierId.trim()} onClick={loadSlots}>
          {loading ? "Загрузка…" : "Доступные слоты"}
        </button>
      </div>

      {error ? (
        <p style={{ color: "#b91c1c", marginTop: "1rem" }} role="alert">
          {error}
        </p>
      ) : null}

      <ul style={{ marginTop: "1.25rem", paddingLeft: "1.1rem" }}>
        {slots.map((s) => (
          <li key={s.id} style={{ marginBottom: "0.5rem" }}>
            <code>{s.id.slice(0, 8)}…</code> — {new Date(s.starts_at).toLocaleString()} →{" "}
            {new Date(s.ends_at).toLocaleString()} — занято {s.booked_count}/{s.capacity}
          </li>
        ))}
      </ul>
      {!loading && slots.length === 0 && courierId ? (
        <p style={{ color: "#71717a" }}>Нет слотов в диапазоне или курьер без локаций.</p>
      ) : null}
    </div>
  );
}
