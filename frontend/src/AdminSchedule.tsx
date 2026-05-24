import { useCallback, useEffect, useState } from "react";
import CourierSlotPlanner from "./CourierSlotPlanner";
import type { LocationDto } from "./types";

const API = "/api";

const ADMIN_JWT_KEY = "courier_admin_jwt";
const LEGACY_ADMIN_TOKEN_KEY = "courier_admin_token";

function adminHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
}

async function readApiError(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as { detail?: unknown; message?: string };
    if (typeof j.message === "string") return j.message;
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

function Logo() {
  return (
    <div style={{ width: "100%", display: "flex", justifyContent: "center", textAlign: "center" }}>
      <img
        src="/logo-vkusvill-jdun.png"
        alt="ВкусВилл Ждун"
        style={{ display: "block", width: "min(100%, 420px)", height: "auto", objectFit: "contain" }}
      />
    </div>
  );
}

export default function AdminSchedule() {
  const [token, setToken] = useState("");
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [displayName, setDisplayName] = useState("");

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [locations, setLocations] = useState<LocationDto[]>([]);

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
    setMsg(null);
    setErr(null);
  }, []);

  const refreshLocations = useCallback(
    async (overrideAccessToken?: string) => {
      const raw = (overrideAccessToken ?? token).trim();
      setErr(null);
      setMsg(null);
      if (!raw) {
        setLocations([]);
        return [];
      }
      try {
        const lr = await fetch(`${API}/admin/locations`, { headers: adminHeaders(raw) });
        if (lr.status === 401) {
          logout();
          setErr("Сессия недействительна или истекла. Войдите снова.");
          return [];
        }
        if (!lr.ok) throw new Error(await readApiError(lr));
        const nextLocations = (await lr.json()) as LocationDto[];
        setLocations(nextLocations);
        return nextLocations;
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Ошибка загрузки локаций");
        return [];
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
      setLoginUser(j.username ?? "master");
      await refreshLocations(saved);
    })();
  }, [refreshLocations]);

  useEffect(() => {
    if (token) void refreshLocations();
  }, [refreshLocations, token]);

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
      await refreshLocations(data.access_token);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка входа");
    } finally {
      setLoginBusy(false);
    }
  };

  const createLocation = async ({ name, timezone }: { name: string; timezone: string }) => {
    setErr(null);
    setMsg(null);
    try {
      const r = await fetch(`${API}/admin/locations`, {
        method: "POST",
        headers: adminHeaders(token.trim()),
        body: JSON.stringify({ name: name.trim(), timezone }),
      });
      if (!r.ok) throw new Error(await readApiError(r));
      const j = (await r.json()) as { id?: string };
      const nextLocations = await refreshLocations();
      const created = nextLocations.find((l) => l.id === j.id) ?? nextLocations.at(-1);
      if (!created) throw new Error("Локация создана, но список не обновился");
      setMsg(`Локация создана: ${created.name}`);
      return created;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
      throw e;
    }
  };

  if (!token) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "32px 16px",
          background: "linear-gradient(160deg, #f4fff8 0%, #f8f9fa 46%, #eef8f2 100%)",
        }}
      >
        <section
          style={{
            width: "min(100%, 440px)",
            background: "#fff",
            border: "1px solid #dcefe4",
            borderRadius: 28,
            padding: "34px 34px 30px",
            boxShadow: "0 24px 70px rgba(16, 92, 54, 0.12)",
          }}
        >
          <Logo />
          <p style={{ margin: "30px 0 24px", color: "#5b6470", fontSize: 15 }}>
            Войдите, чтобы управлять слотами курьеров и локациями.
          </p>

          <div style={{ display: "grid", gap: 14 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700, color: "#374151" }}>
              Логин
              <input
                style={loginInputStyle}
                autoComplete="username"
                value={loginUser}
                onChange={(e) => setLoginUser(e.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700, color: "#374151" }}>
              Пароль
              <input
                style={loginInputStyle}
                type="password"
                autoComplete="current-password"
                value={loginPass}
                onChange={(e) => setLoginPass(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void doLogin();
                }}
              />
            </label>
            {err ? (
              <div style={{ color: "#b91c1c", fontSize: 13 }} role="alert">
                {err}
              </div>
            ) : null}
            <button
              type="button"
              disabled={loginBusy}
              onClick={() => void doLogin()}
              style={{
                marginTop: 4,
                border: "none",
                borderRadius: 14,
                padding: "13px 18px",
                background: "#1D9E75",
                color: "#fff",
                fontWeight: 800,
                fontSize: 15,
                cursor: loginBusy ? "wait" : "pointer",
                boxShadow: "0 10px 24px rgba(29, 158, 117, 0.24)",
              }}
            >
              {loginBusy ? "Входим..." : "Войти"}
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <CourierSlotPlanner
      accessToken={token.trim()}
      locations={locations}
      adminName={displayName || loginUser}
      onUnauthorized={logout}
      onLogout={logout}
      onRefreshLocations={() => refreshLocations()}
      onCreateLocation={createLocation}
      notice={msg}
      errorNotice={err}
    />
  );
}

const loginInputStyle = {
  width: "100%",
  border: "1px solid #d1d5db",
  borderRadius: 12,
  padding: "12px 13px",
  fontSize: 15,
  outline: "none",
  background: "#fff",
};
