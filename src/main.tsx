import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Fuel, Heart, Menu, Moon, Sun } from "lucide-react";
import {
  api,
  brand,
  euros,
  fuels,
  savings,
  stamp,
  type Price,
  type Station,
} from "./data";
import { independenceNotice } from "./identity";
import "./style.css";

const HistoryChart = lazy(() =>
  import("./charts").then((module) => ({ default: module.HistoryChart })),
);
const SavingsChart = lazy(() =>
  import("./charts").then((module) => ({ default: module.SavingsChart })),
);
const nav = [
  ["/", "Inicio"],
  ["/historico", "Histórico"],
  ["/calculadora", "Calculadora"],
  ["/favoritos", "Favoritos"],
];
const legal = [
  ["aviso-legal", "Aviso legal"],
  ["privacidad", "Privacidad"],
  ["cookies", "Cookies"],
  ["condiciones", "Condiciones"],
  ["contacto", "Contacto"],
  ["fuentes", "Fuentes"],
  ["sobre-nosotros", "Sobre nosotros"],
];
function readFavorites(): string[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem("favorites") ?? "[]",
    );
    return Array.isArray(value)
      ? value.filter((x) => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}
function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}
function FuelOptions() {
  return (
    <>
      {Object.entries(fuels).map(([id, label]) => (
        <option value={id} key={id}>
          {label}
        </option>
      ))}
    </>
  );
}
function StationOptions({ stations }: { stations: Station[] }) {
  return (
    <>
      <option value="">Elige una gasolinera</option>
      {stations.map((s) => (
        <option value={s.slug} key={s.slug}>
          {s.name}
        </option>
      ))}
    </>
  );
}
function Heading({
  label,
  title,
  description,
}: {
  label: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="page-heading">
      <span className="eyebrow">{label}</span>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="panel empty" role="status">
      {children}
    </div>
  );
}
function Loading() {
  return <div className="skeleton" role="status" aria-label="Cargando datos" />;
}
function App() {
  const path = location.pathname.replace(/\/$/, "") || "/";
  const [stations, setStations] = useState<Station[]>([]),
    [prices, setPrices] = useState<Price[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [menu, setMenu] = useState(false);
  const [favorites, setFavorites] = useState(readFavorites);
  const [theme, setTheme] = useState(
    () =>
      localStorage.getItem("theme") ??
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem("favorites", JSON.stringify(favorites));
  }, [favorites]);
  useEffect(() => {
    let active = true;
    async function refresh() {
      if (document.hidden) return;
      try {
        const [s, p] = await Promise.all([
          api<{ data: Station[] }>("/stations"),
          api<{ data: Price[] }>("/prices"),
        ]);
        if (active) {
          setStations(s.data);
          setPrices(p.data);
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    }
    void refresh();
    const interval = setInterval(refresh, 180000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  const toggle = (slug: string) =>
    setFavorites((current) =>
      current.includes(slug)
        ? current.filter((s) => s !== slug)
        : [...current, slug],
    );
  useEffect(() => {
    const label =
      nav.find(([url]) => url === path)?.[1] ??
      legal.find(([url]) => "/" + url === path)?.[1];
    if (label && path !== "/") document.title = label + " | " + brand.name;
    if (document.querySelector("link[rel=canonical]")) return;
    const canonical = document.createElement("link");
    canonical.rel = "canonical";
    canonical.href = location.origin + path;
    document.head.appendChild(canonical);
    return () => {
      canonical.remove();
    };
  }, [path]);
  const member = prices.filter((p) => p.source === "telegram");
  const legalPage = legal.find(([url]) => "/" + url === path);
  let content: ReactNode;
  if (legalPage) content = <Legal slug={legalPage[0]} title={legalPage[1]} />;
  else if (path === "/admin") content = <Admin />;
  else if (path === "/" || path === "/historico")
    content = (
      <>
        <Heading
          label="Evolución"
          title="Histórico de precios"
          description="Consulta cuándo cambió el precio de cada combustible."
        />
        <History stations={stations} favorites={favorites} toggle={toggle} />
      </>
    );
  else if (path === "/calculadora")
    content = <Calculator stations={stations} prices={member} />;
  else if (path === "/favoritos")
    content = (
      <>
        <Heading label="Tus estaciones" title="Favoritos" />
        {loading ? (
          <Loading />
        ) : (
          <Favorites
            stations={stations}
            favorites={favorites}
            toggle={toggle}
          />
        )}
      </>
    );
  else
    content = loading ? (
      <Loading />
    ) : (
      <>
        <Heading label="404" title="Página no encontrada" />
        <a className="button primary" href="/">
          Volver a inicio
        </a>
      </>
    );
  return (
    <>
      <a className="skip" href="#contenido">
        Saltar al contenido
      </a>
      <header className="site-header">
        <div className="shell header-row">
          <a className="brand" href="/">
            <span>
              <Fuel size={21} />
            </span>
            {brand.name}
          </a>
          <button
            className="icon menu-toggle"
            aria-label="Abrir menú"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <Menu size={21} />
          </button>
          <nav className={menu ? "open" : ""} aria-label="Principal">
            {nav.map(([url, label]) => (
              <a
                key={url}
                href={url}
                aria-current={path === url ? "page" : undefined}
              >
                {label}
              </a>
            ))}
          </nav>
          <button
            className="icon"
            aria-label="Cambiar tema"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
          </button>
        </div>
      </header>
      <main id="contenido" className="shell">
        {path === "/" && (
          <aside
            className="notice independence"
            aria-label="Proyecto independiente"
          >
            {independenceNotice}
          </aside>
        )}
        {error && (
          <p className="notice error" role="status">
            {error}.{" "}
            {prices.length
              ? "Se muestran los últimos datos recibidos."
              : "Puedes volver a intentarlo recargando la página."}
          </p>
        )}
        {content}
      </main>
      <footer>
        <div className="shell footer">
          <div>
            <a className="brand" href="/">
              <span>
                <Fuel size={18} />
              </span>
              {brand.name}
            </a>
            <p>Proyecto personal e independiente de Costco.</p>
            <p>
              Desarrollado por <a href="https://zetaweb.es/">zetaweb.es</a>
            </p>
          </div>
          <nav aria-label="Información legal">
            {legal.map(([url, label]) => (
              <a key={url} href={"/" + url}>
                {label}
              </a>
            ))}
          </nav>
        </div>
      </footer>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Favorites({
  stations,
  favorites,
  toggle,
}: {
  stations: Station[];
  favorites: string[];
  toggle: (slug: string) => void;
}) {
  const saved = stations.filter((s) => favorites.includes(s.slug));
  return saved.length ? (
    <ul className="favorites-list">
      {saved.map((s) => (
        <li key={s.slug} className="panel">
          <a href={"/historico?station=" + s.slug}>{s.name}</a>
          <button
            className="icon"
            onClick={() => toggle(s.slug)}
            aria-label="Quitar de favoritos"
          >
            <Heart size={19} fill="currentColor" />
          </button>
        </li>
      ))}
    </ul>
  ) : (
    <Empty>
      Guarda estaciones desde el <a href="/historico">histórico de precios</a>.
    </Empty>
  );
}
const initialStation = () =>
  new URLSearchParams(location.search).get("station") ?? "";
function History({
  stations,
  favorites,
  toggle,
}: {
  stations: Station[];
  favorites: string[];
  toggle: (slug: string) => void;
}) {
  const [station, setStation] = useState(initialStation()),
    [fuel, setFuel] = useState("gas95"),
    [days, setDays] = useState("90"),
    [start, setStart] = useState(""),
    [end, setEnd] = useState("");
  const source = "telegram";
  type Series = {
    data: Price[];
    since?: string;
    until?: string;
    summary?: {
      average: number | null;
      baseline: number | null;
      minimum: number | null;
      maximum: number | null;
    };
  };
  const [series, setSeries] = useState<Record<string, Series>>({}),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const selected = station || stations[0]?.slug || "";
  useEffect(() => {
    if (!selected || (days === "custom" && (!start || !end))) return;
    const controller = new AbortController();
    async function load() {
      setError("");
      setLoading(true);
      setSeries({});
      try {
        const from =
          days === "custom"
            ? start
            : days === "all"
              ? "2000-01-01"
              : new Date(Date.now() - Number(days) * 86400000)
                  .toISOString()
                  .slice(0, 10);
        const query = new URLSearchParams({
          station: selected,
          fuel,
          source,
          from,
        });
        if (days === "custom") query.set("to", end);
        const result = await api<Series>(
          "/prices/history?" + query.toString(),
          { signal: controller.signal },
        );
        if (!controller.signal.aborted)
          setSeries({
            [selected]: { ...result, data: [...result.data].reverse() },
          });
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [selected, fuel, source, days, start, end]);
  const main = series[selected];
  const rows = main?.data ?? [];
  const chart = Object.entries(series).map(([id, result]) => {
    const points = result.data.map((p) => ({
      time: Date.parse(p.published_at),
      price: p.price / 1000,
    }));
    if (
      result.data.length < 366 &&
      result.summary?.baseline != null &&
      result.since &&
      result.until &&
      result.since < result.until
    )
      points.unshift({
        time: Date.parse(result.since),
        price: result.summary.baseline / 1000,
      });
    if (points.length && result.until)
      points.push({
        time: Date.parse(result.until),
        price: points.at(-1)!.price,
      });
    return {
      id,
      name: stations.find((s) => s.slug === id)?.name ?? id,
      points,
    };
  });
  const values = rows.map((row) => row.price);
  const first = rows[0],
    last = rows.at(-1);
  const delta =
    first && last ? ((last.price - first.price) / first.price) * 100 : 0;
  function csv() {
    const data = [
      "estacion;fecha_utc;precio_eur_l;anterior_eur_l;fuente",
      ...Object.values(series)
        .flatMap((s) => s.data)
        .map((p) =>
          [
            p.station,
            p.published_at,
            (p.price / 1000).toFixed(3),
            p.previous === null ? "" : (p.previous / 1000).toFixed(3),
            p.source,
          ].join(";"),
        ),
    ].join("\n");
    const href = URL.createObjectURL(
      new Blob([data], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = href;
    a.download = "historico-" + selected + ".csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  return (
    <section className="panel feature">
      <div className="history-heading">
        <h2>Evolución del precio</h2>
        {selected && (
          <button
            className="icon"
            onClick={() => toggle(selected)}
            aria-pressed={favorites.includes(selected)}
            aria-label={
              favorites.includes(selected)
                ? "Quitar de favoritos"
                : "Guardar en favoritos"
            }
          >
            <Heart
              size={19}
              fill={favorites.includes(selected) ? "currentColor" : "none"}
            />
          </button>
        )}
      </div>
      <div className="form-grid">
        <Select label="Gasolinera" value={selected} onChange={setStation}>
          <StationOptions stations={stations} />
        </Select>
        <Select label="Combustible" value={fuel} onChange={setFuel}>
          <FuelOptions />
        </Select>
        <Select label="Periodo" value={days} onChange={setDays}>
          <option value="1">Último día</option>
          {[7, 30, 90, 180, 365].map((d) => (
            <option key={d} value={d}>
              {d} días
            </option>
          ))}
          <option value="all">Todo lo disponible</option>
          <option value="custom">Rango personalizado</option>
        </Select>
        {days === "custom" && (
          <>
            <label>
              Desde
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              Hasta
              <input
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </>
        )}
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <p role="alert">{error}</p>
      ) : !chart.some((s) => s.points.length) ? (
        <Empty>No hay cambios registrados para esta selección.</Empty>
      ) : (
        <>
          <div className="metrics">
            <Metric
              label="Mínimo registrado"
              value={
                main?.summary?.minimum != null
                  ? euros(main.summary.minimum / 1000)
                  : values.length
                    ? euros(Math.min(...values) / 1000)
                    : "—"
              }
            />
            <Metric
              label="Máximo registrado"
              value={
                main?.summary?.maximum != null
                  ? euros(main.summary.maximum / 1000)
                  : values.length
                    ? euros(Math.max(...values) / 1000)
                    : "—"
              }
            />
            <Metric
              label="Variación del periodo"
              value={delta.toFixed(2) + " %"}
            />
            <Metric label="Cambios mostrados" value={String(rows.length)} />
          </div>
          <Suspense fallback={<Loading />}>
            <HistoryChart series={chart} />
          </Suspense>
          <div className="metrics">
            {Object.entries(series).map(([id, result]) => (
              <Metric
                key={id}
                label={
                  "Media ponderada · " +
                  (stations.find((s) => s.slug === id)?.name ?? id)
                }
                value={
                  result.summary?.average == null
                    ? "—"
                    : euros(result.summary.average / 1000) + "/L"
                }
              />
            ))}
          </div>
          <p className="muted">
            {rows.length} observaciones con cambios en el periodo.{" "}
            {Object.values(series).some((s) => s.data.length === 366) &&
              "La gráfica muestra hasta 366 cambios recientes por estación. "}{" "}
            Cobertura según las publicaciones disponibles.
          </p>
          <button className="button" onClick={csv}>
            Descargar CSV
          </button>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Precio por litro</th>
                  <th>Anterior</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((p) => (
                  <tr key={p.event}>
                    <td>{stamp(p.published_at)}</td>
                    <td>{euros(p.price / 1000)}</td>
                    <td>
                      {p.previous === null ? "—" : euros(p.previous / 1000)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
function NumberField({
  label,
  value,
  change,
  step = "1",
}: {
  label: string;
  value: number;
  change: (n: number) => void;
  step?: string;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        min="0"
        step={step}
        value={value}
        onChange={(e) => change(Math.max(0, Number(e.target.value) || 0))}
      />
    </label>
  );
}
function Calculator({
  stations,
  prices,
}: {
  stations: Station[];
  prices: Price[];
}) {
  const [station, setStation] = useState(initialStation()),
    [fuel, setFuel] = useState("gas95"),
    [manual, setManual] = useState(0),
    [other, setOther] = useState(0),
    [capacity, setCapacity] = useState(50),
    [liters, setLiters] = useState(50),
    [consumption, setConsumption] = useState(6),
    [monthKm, setMonthKm] = useState(0),
    [fills, setFills] = useState(2),
    [km, setKm] = useState(0),
    [fee, setFee] = useState(0);
  const selected = station || stations[0]?.slug || "";
  const recorded = prices.find(
    (p) => p.station === selected && p.fuel === fuel,
  );
  const costco = recorded ? recorded.price / 1000 : manual;
  const used = Math.min(liters, capacity),
    effectiveFills =
      monthKm > 0 && used > 0 ? (monthKm * consumption) / 100 / used : fills;
  const result = savings(
    costco,
    other,
    used,
    consumption,
    km,
    effectiveFills,
    fee,
  );
  return (
    <>
      <Heading
        label="Calcula tu ahorro"
        title="¿Cuánto te ahorras al repostar?"
        description="Incluye el coste del trayecto y la cuota de socio si quieres comparar el gasto anual."
      />
      <div className="two-column">
        <section className="panel feature">
          <h2>Datos del repostaje</h2>
          <div className="form-grid">
            <Select label="Gasolinera" value={selected} onChange={setStation}>
              <StationOptions stations={stations} />
            </Select>
            <Select label="Combustible" value={fuel} onChange={setFuel}>
              <FuelOptions />
            </Select>
            {recorded ? (
              <p>
                Precio de socios · <strong>{euros(costco)}/L</strong>
              </p>
            ) : (
              <NumberField
                label="Precio Costco (€/L, manual)"
                value={manual}
                change={setManual}
                step=".001"
              />
            )}
            <NumberField
              label="Otra gasolinera (€/L)"
              value={other}
              change={setOther}
              step=".001"
            />
            <NumberField
              label="Capacidad del depósito (L)"
              value={capacity}
              change={setCapacity}
            />
            <NumberField
              label="Litros repostados"
              value={liters}
              change={setLiters}
            />
            <NumberField
              label="Consumo (L/100 km)"
              value={consumption}
              change={setConsumption}
              step=".1"
            />
            <NumberField
              label="Km mensuales (opcional)"
              value={monthKm}
              change={setMonthKm}
            />
            <NumberField
              label="Repostajes al mes"
              value={fills}
              change={setFills}
            />
            <NumberField
              label="Km extra de ida y vuelta"
              value={km}
              change={setKm}
            />
            <NumberField
              label="Cuota anual (€)"
              value={fee}
              change={setFee}
              step=".01"
            />
          </div>
          {monthKm > 0 && (
            <p className="muted">
              Se estiman {effectiveFills.toFixed(1)} repostajes al mes a partir
              de tus kilómetros y consumo.
            </p>
          )}
        </section>
        <section className="panel feature">
          <h2>Resultado estimado</h2>
          {costco > 0 && other > 0 && used > 0 ? (
            <>
              <strong className="big">{euros(result.annual, 2)}</strong>
              <p>Ahorro anual neto con cuota incluida</p>
              <dl className="results">
                {[
                  ["Coste en Costco", euros(costco * used, 2)],
                  ["Coste en otra estación", euros(other * used, 2)],
                  ["Diferencia por litro", euros(other - costco)],
                  ["Ahorro por depósito", euros(result.perFill, 2)],
                  ["Coste del trayecto", euros(result.trip, 2)],
                  ["Ahorro neto por visita", euros(result.net, 2)],
                  ["Ahorro neto mensual", euros(result.monthly, 2)],
                  [
                    "Ahorro anual antes de cuota",
                    euros(result.annual + fee, 2),
                  ],
                  [
                    "Visitas para amortizar",
                    result.breakEven ?? "Sin amortización",
                  ],
                  [
                    "Distancia máxima adicional",
                    result.maxDistance === null
                      ? "—"
                      : result.maxDistance.toFixed(1) + " km",
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <Suspense fallback={<Loading />}>
                <SavingsChart costco={costco * used} other={other * used} />
              </Suspense>
            </>
          ) : (
            <Empty>Introduce precios y litros para calcular el ahorro.</Empty>
          )}
        </section>
      </div>
    </>
  );
}
function Admin() {
  const [token, setToken] = useState(""),
    [error, setError] = useState(""),
    [result, setResult] = useState(""),
    [busy, setBusy] = useState(false),
    [logs, setLogs] = useState<
      { id: number; source: string; result: string; created_at: string }[]
    >([]),
    [overview, setOverview] = useState<{
      totals: Record<string, number>;
      state: { source: string; last_success: string | null }[];
      messages: { id: number; published_at: string }[];
    } | null>(null);
  async function action(path: string, method: string) {
    setBusy(true);
    setError("");
    setResult("");
    try {
      const options = { method, headers: { authorization: "Bearer " + token } };
      if (method === "POST") {
        const r = await api<{ data: unknown }>(path, options);
        setResult(JSON.stringify(r.data));
      }
      const [logResult, summary] = await Promise.all([
        api<{ data: typeof logs }>("/admin/logs", {
          ...options,
          method: "GET",
        }),
        api<NonNullable<typeof overview>>("/admin/overview", {
          ...options,
          method: "GET",
        }),
      ]);
      setLogs(logResult.data);
      setOverview(summary);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading label="Acceso restringido" title="Administración" />
      <section className="panel feature">
        <label>
          Token administrativo
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
          />
        </label>
        <div className="actions">
          {[
            ["Consultar registros", "/admin/logs", "GET"],
            ["Sincronizar Telegram", "/admin/sync", "POST"],
            ["Importar página anterior", "/admin/import", "POST"],
          ].map(([label, path, method]) => (
            <button
              key={label}
              className="button"
              disabled={busy || !token}
              onClick={() => void action(path, method)}
            >
              {label}
            </button>
          ))}
        </div>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {result && <p role="status">{result}</p>}
        {overview && (
          <>
            <h2>Estado del sistema</h2>
            <div className="metrics">
              {Object.entries({
                stations: "Estaciones",
                changes: "Cambios de precio",
                messages: "Mensajes",
                subscriptions: "Suscripciones",
                recent_push: "Avisos recientes",
              }).map(([key, label]) => (
                <Metric
                  key={key}
                  label={label}
                  value={String(overview.totals[key])}
                />
              ))}
            </div>
            <ul>
              {overview.state.map((s) => (
                <li key={s.source}>
                  {s.source} ·{" "}
                  {s.last_success
                    ? stamp(s.last_success)
                    : "Sin sincronización correcta"}
                </li>
              ))}
            </ul>
            <h3>Mensajes recientes</h3>
            <ul>
              {overview.messages.map((m) => (
                <li key={m.id}>
                  <span>Publicación {m.id}</span> · {stamp(m.published_at)}
                </li>
              ))}
            </ul>
            <h3>Registros de sincronización</h3>
          </>
        )}
        <ul>
          {logs.map((l) => (
            <li key={l.id}>
              {l.created_at} UTC · {l.source} · {l.result}
            </li>
          ))}
        </ul>
      </section>
      {overview && token && <AdminEditor key={token} token={token} />}
    </>
  );
}

function AdminEditor({ token }: { token: string }) {
  type Catalog = {
    stations: { slug: string; name: string; active: number }[];
    fuels: { id: string; name: string }[];
    aliases: { alias: string; station: string }[];
    settings: { key: string; value: string }[];
    audit: { action: string; created_at: string }[];
    corrections: {
      station: string;
      fuel: string;
      price: number;
      reason: string;
    }[];
  };
  type Observation = {
    event: string;
    published_at: string;
    original: number;
    price: number;
  };
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [action, setAction] = useState("station"),
    [station, setStation] = useState(""),
    [fuel, setFuel] = useState("gas95"),
    [source, setSource] = useState("telegram");
  const [event, setEvent] = useState(""),
    [name, setName] = useState(""),
    [alias, setAlias] = useState(""),
    [price, setPrice] = useState("");
  const [active, setActive] = useState(true),
    [paused, setPaused] = useState(false),
    [reason, setReason] = useState(""),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const headers = {
    authorization: "Bearer " + token,
    "content-type": "application/json",
  };
  const selected = station || catalog?.stations[0]?.slug || "";
  useEffect(() => {
    const controller = new AbortController();
    void api<Catalog>("/admin/config", {
      headers: { authorization: "Bearer " + token },
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setCatalog(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setNotice(e.message);
      });
    return () => controller.abort();
  }, [token]);
  useEffect(() => {
    if (action !== "price" || !selected) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ station: selected, fuel, source });
    void api<{ data: Observation[] }>("/admin/config/observations?" + query, {
      headers: { authorization: "Bearer " + token },
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setObservations(result.data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setNotice(e.message);
      });
    return () => controller.abort();
  }, [action, selected, fuel, source, token]);
  function changeFilter(setter: (value: string) => void, value: string) {
    setEvent("");
    setObservations([]);
    setter(value);
  }
  async function save() {
    setBusy(true);
    setNotice("");
    try {
      await api("/admin/config", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action,
          station: selected,
          fuel,
          source,
          event,
          name,
          alias,
          price: Math.round(Number(price) * 1000),
          active,
          paused,
          reason,
        }),
      });
      setCatalog(await api<Catalog>("/admin/config", { headers }));
      if (action === "price") {
        const query = new URLSearchParams({ station: selected, fuel, source });
        setObservations(
          (
            await api<{ data: Observation[] }>(
              "/admin/config/observations?" + query,
              { headers },
            )
          ).data,
        );
      }
      setNotice("Cambio guardado y auditado.");
      setReason("");
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel feature">
      <h2>Gestionar catálogo y precios</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="form-grid">
          <Select
            label="Operación"
            value={action}
            onChange={(v) => changeFilter(setAction, v)}
          >
            <option value="station">Cambiar nombre o visibilidad</option>
            <option value="alias">Asignar alias de Telegram</option>
            <option value="fuel">Renombrar combustible</option>
            <option value="source">Pausar o reanudar fuente</option>
            <option value="price">Corregir una observación</option>
          </Select>
          {["station", "alias", "price"].includes(action) && (
            <Select
              label="Estación"
              value={selected}
              onChange={(v) => changeFilter(setStation, v)}
            >
              {catalog?.stations.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name}
                  {s.active ? "" : " (oculta)"}
                </option>
              ))}
            </Select>
          )}
          {["fuel", "price"].includes(action) && (
            <Select
              label="Combustible"
              value={fuel}
              onChange={(v) => changeFilter(setFuel, v)}
            >
              {catalog?.fuels.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          )}
          {["source", "price"].includes(action) && (
            <Select
              label="Fuente"
              value={source}
              onChange={(v) => changeFilter(setSource, v)}
            >
              <option value="telegram">Telegram</option>
            </Select>
          )}
          {["station", "fuel"].includes(action) && (
            <label>
              Nombre nuevo
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                required
              />
            </label>
          )}
          {action === "station" && (
            <label className="check">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />{" "}
              Visible al público
            </label>
          )}
          {action === "alias" && (
            <label>
              Nombre alternativo en Telegram
              <input
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                required
              />
            </label>
          )}
          {action === "source" && (
            <label className="check">
              <input
                type="checkbox"
                checked={paused}
                onChange={(e) => setPaused(e.target.checked)}
              />{" "}
              Fuente en pausa
            </label>
          )}
          {action === "price" && (
            <>
              <Select
                label="Observación de origen"
                value={event}
                onChange={setEvent}
              >
                <option value="">Selecciona una fecha</option>
                {observations.map((o) => (
                  <option key={o.event} value={o.event}>
                    {stamp(o.published_at)} · {euros(o.price / 1000)}/L
                    {o.price !== o.original ? " (corregido)" : ""}
                  </option>
                ))}
              </Select>
              <label>
                Precio corregido €/L
                <input
                  type="number"
                  min=".300"
                  max="5"
                  step=".001"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  required
                />
              </label>
            </>
          )}
          <label>
            Motivo del cambio
            <input
              required
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </div>
        <div className="actions">
          <button
            className="button primary"
            disabled={busy || !catalog || (action === "price" && !event)}
          >
            Guardar cambio
          </button>
        </div>
      </form>
      {notice && <p role="status">{notice}</p>}
      {catalog && (
        <>
          <h3>Fuentes pausadas</h3>
          <p>
            {catalog.settings
              .filter((s) => s.value === "true")
              .map((s) => s.key.replace("pause:", ""))
              .join(", ") || "Ninguna"}
          </p>
          <h3>Alias registrados</h3>
          <ul>
            {catalog.aliases.map((a) => (
              <li key={a.alias}>
                {a.alias} → {a.station}
              </li>
            ))}
          </ul>
          <h3>Auditoría reciente</h3>
          <ul>
            {catalog.audit.map((a, i) => (
              <li key={i}>
                {a.created_at} UTC · {a.action}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Legal({ slug, title }: { slug: string; title: string }) {
  const content: Record<string, ReactNode> = {
    "aviso-legal": (
      <>
        <p>{independenceNotice}</p>
        <p>
          El nombre Costco se usa para identificar las gasolineras que se
          consultan o comparan.
        </p>
        <p>
          {brand.operator
            ? "Titular: " + brand.operator
            : "Los datos de contacto del titular están pendientes de configurar."}
        </p>
      </>
    ),
    privacidad: (
      <>
        <p>
          Guardamos en el navegador el tema y tus favoritos. La web utiliza
          Cloudflare para servir el sitio y sus datos.
        </p>
      </>
    ),
    cookies: (
      <p>
        La aplicación usa almacenamiento local para el tema y los favoritos. No
        instala cookies de publicidad ni activa analítica.
      </p>
    ),
    condiciones: (
      <p>
        Los precios son orientativos y pueden cambiar. Comprueba el importe y
        las condiciones comerciales en la estación antes de repostar. Las
        distancias del comparador se calculan en línea recta.
      </p>
    ),
    contacto: brand.contact ? (
      <p>
        <a href={"mailto:" + brand.contact}>{brand.contact}</a>
      </p>
    ) : (
      <p>El correo de contacto del proyecto está pendiente de configurar.</p>
    ),
    fuentes: (
      <>
        <ul>
          <li>Telegram · precios para socios</li>
        </ul>

        <p>
          Esta web publica los precios de combustible autorizados para socios de
          Costco.
        </p>
      </>
    ),
    "sobre-nosotros": (
      <>
        <p>{independenceNotice}</p>
        <p>
          {brand.name} reúne precios y ubicaciones para ayudarte a decidir si
          compensa desplazarte para repostar.
        </p>
      </>
    ),
  };
  return (
    <>
      <Heading label={brand.name} title={title} />
      <section className="panel feature prose">{content[slug]}</section>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
if ("serviceWorker" in navigator && import.meta.env.PROD)
  window.addEventListener(
    "load",
    () => void navigator.serviceWorker.register("/sw.js").catch(() => {}),
  );
