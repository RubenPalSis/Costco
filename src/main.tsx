import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bell,
  Fuel,
  Heart,
  MapPin,
  Menu,
  Moon,
  Sun,
  TrendingDown,
} from "lucide-react";
import {
  api,
  brand,
  euros,
  fuels,
  maps,
  savings,
  stamp,
  type Nearby,
  type Price,
  type Station,
  type Status,
} from "./data";
import { distance } from "../worker/distance";
import { independenceNotice } from "./identity";
import "./style.css";

const FuelMap = lazy(() => import("./map"));
const HistoryChart = lazy(() =>
  import("./charts").then((module) => ({ default: module.HistoryChart })),
);
const SavingsChart = lazy(() =>
  import("./charts").then((module) => ({ default: module.SavingsChart })),
);
const EMPTY_NEARBY: Nearby[] = [];
const nav = [
  ["/", "Inicio"],
  ["/gasolineras", "Gasolineras"],
  ["/mapa", "Mapa"],
  ["/historico", "Histórico"],
  ["/comparador", "Comparador"],
  ["/calculadora", "Calculadora"],
  ["/alertas", "Alertas"],
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
const sourceName = (source: string) =>
  source === "telegram" ? "Socios · Telegram" : "Precio declarado · MITECO";
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
function useNearby(station: string, fuel: string, radius: string) {
  const [state, setState] = useState<{
    data: Nearby[];
    error: string;
    loading: boolean;
  }>({ data: [], error: "", loading: false });
  useEffect(() => {
    if (!station) return;
    const controller = new AbortController();
    const load = async () => {
      setState({ data: [], error: "", loading: true });
      try {
        const { data } = await api<{ data: Nearby[] }>(
          "/compare?" + new URLSearchParams({ station, fuel, radius }),
          { signal: controller.signal },
        );
        if (!controller.signal.aborted)
          setState({ data, error: "", loading: false });
      } catch (e) {
        if (!controller.signal.aborted)
          setState({ data: [], error: (e as Error).message, loading: false });
      }
    };
    void load();
    return () => controller.abort();
  }, [station, fuel, radius]);
  return station ? state : { data: EMPTY_NEARBY, error: "", loading: false };
}
function App() {
  const path = location.pathname.replace(/\/$/, "") || "/";
  const [stations, setStations] = useState<Station[]>([]),
    [prices, setPrices] = useState<Price[]>([]),
    [status, setStatus] = useState<Status | null>(null);
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
        const [s, p, t] = await Promise.all([
          api<{ data: Station[] }>("/stations"),
          api<{ data: Price[] }>("/prices"),
          api<Status>("/status"),
        ]);
        if (active) {
          setStations(s.data);
          setPrices(p.data);
          setStatus(t);
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
  const station = stations.find((s) => path === "/gasolineras/" + s.slug);
  useEffect(() => {
    const label =
      station?.name ??
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
  }, [path, station]);
  const member = prices.filter((p) => p.source === "telegram");
  const defaultSource = status?.officialEnabled && !status.telegramEnabled ? "official" : "telegram";
  const legalPage = legal.find(([url]) => "/" + url === path);
  let content: ReactNode;
  if (legalPage) content = <Legal slug={legalPage[0]} title={legalPage[1]} />;
  else if (path === "/admin") content = <Admin />;
  else if (path === "/historico")
    content = (
      <>
        <Heading
          label="Evolución"
          title="Histórico de precios"
          description="Consulta cuándo cambió el precio de cada combustible."
        />
        <History key={defaultSource} stations={stations} defaultSource={defaultSource} />
      </>
    );
  else if (path === "/comparador")
    content = <Compare stations={stations} prices={prices} />;
  else if (path === "/calculadora")
    content = <Calculator stations={stations} prices={member} />;
  else if (path === "/alertas")
    content = <Alerts stations={stations} pushKey={status?.pushKey ?? null} />;
  else if (path === "/mapa")
    content = <MapPage key={defaultSource} stations={stations} prices={prices} defaultSource={defaultSource} />;
  else if (station)
    content = (
      <>
        <Heading
          label={station.province}
          title={station.name}
          description={station.address ?? station.city}
        />
        <div className="detail-grid">
          <Card
            station={station}
            prices={prices}
            saved={favorites.includes(station.slug)}
            toggle={toggle}
          />
          <div className="panel">
            <h2>Horario y ubicación</h2>
            <p>{station.hours ?? "Horario sin confirmar"}</p>
            <a href={maps(station)}>
              Ver indicaciones <ArrowRight size={16} />
            </a>
          </div>
        </div>
        <History key={defaultSource} stations={stations} initial={station.slug} defaultSource={defaultSource} />
        <div className="station-actions">
          <a href={"/comparador?station=" + station.slug}>
            Comparar estaciones cercanas
          </a>
          <a href={"/calculadora?station=" + station.slug}>Calcular ahorro</a>
          <a href={"/alertas?station=" + station.slug}>Crear alerta</a>
          <a href="/mapa">Ver mapa</a>
        </div>
      </>
    );
  else if (["/", "/gasolineras", "/favoritos"].includes(path))
    content = (
      <Home
        path={path}
        stations={stations}
        prices={prices}
        status={status}
        loading={loading}
        favorites={favorites}
        toggle={toggle}
      />
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

function Home({
  path,
  stations,
  prices,
  status,
  loading,
  favorites,
  toggle,
}: {
  path: string;
  stations: Station[];
  prices: Price[];
  status: Status | null;
  loading: boolean;
  favorites: string[];
  toggle: (s: string) => void;
}) {
  const [fuel, setFuel] = useState("gas95"),
    [province, setProvince] = useState(""),
    [region, setRegion] = useState(""),
    [sort, setSort] = useState("city"),
    [selectedSource, setSource] = useState(""),
    [max, setMax] = useState(""),
    [onlyDown, setOnlyDown] = useState(false),
    [onlyFavorites, setOnlyFavorites] = useState(path === "/favoritos");
  const [position, setPosition] = useState<GeolocationCoordinates | null>(null),
    [geoError, setGeoError] = useState("");
  const source = selectedSource || (status?.officialEnabled && !status.telegramEnabled ? "official" : "telegram");
  const list = prices.filter((p) => p.source === source);
  const gas = list.filter((p) => p.fuel === "gas95"),
    diesel = list.filter((p) => p.fuel === "diesel");
  const least = (values: Price[]) =>
    values.length ? euros(Math.min(...values.map((p) => p.price)) / 1000) : "—";
  const mean = gas.length
    ? euros(gas.reduce((sum, p) => sum + p.price, 0) / gas.length / 1000)
    : "—";
  const newest = list
    .map((p) => p.verified_at ?? p.published_at)
    .sort()
    .at(-1);
  const stale = newest && Date.now() - Date.parse(newest) > 48 * 3600000;
  const shown = stations
    .map((station) => {
      const price = list.find(
        (p) => p.station === station.slug && p.fuel === fuel,
      );
      const km =
        position && station.latitude !== null && station.longitude !== null
          ? distance(
              position.latitude,
              position.longitude,
              station.latitude,
              station.longitude,
            )
          : Infinity;
      return { station, price, km };
    })
    .filter(
      ({ station, price }) =>
        (!province || station.province === province) &&
        (!region || station.region === region) &&
        (!onlyFavorites || favorites.includes(station.slug)) &&
        (!max || (price !== undefined && price.price <= Number(max) * 1000)) &&
        (!onlyDown || (price?.variation ?? 0) < 0),
    );
  shown.sort((a, b) => {
    if (sort === "distance") return a.km - b.km;
    if (sort === "updated")
      return (b.price?.verified_at ?? "").localeCompare(
        a.price?.verified_at ?? "",
      );
    if (sort === "lower" || sort === "higher")
      return (
        ((a.price?.variation ?? 0) - (b.price?.variation ?? 0)) *
        (sort === "lower" ? 1 : -1)
      );
    if (sort === "price" || sort === "expensive") {
      if (!a.price) return 1;
      if (!b.price) return -1;
      return (a.price.price - b.price.price) * (sort === "price" ? 1 : -1);
    }
    return a.station.city.localeCompare(b.station.city, "es");
  });
  return (
    <>
      {path === "/" ? (
        <section className="hero">
          <div>
            <span className="eyebrow">Costco España</span>
            <h1>
              Precios de combustible,
              <br />
              <em>estación por estación.</em>
            </h1>
            <p>
              Consulta los precios de Costco, compara gasolineras cercanas y
              calcula cuánto puedes ahorrar al repostar.
            </p>
            <div className="actions">
              <a className="button mint" href="#gasolineras">
                Ver gasolineras <ArrowRight size={17} />
              </a>
              <a className="button ghost" href="/mapa">
                <MapPin size={17} /> Explorar el mapa
              </a>
            </div>
          </div>
          <div className="hero-side">
            <span className="hero-icon">
              <Fuel size={68} strokeWidth={1.1} />
            </span>
            <div>
              <span>Gasolina 95 más barata</span>
              <strong>
                {least(gas)}
                {gas.length > 0 && <small> / L</small>}
              </strong>
              <span>{sourceName(source)}</span>
            </div>
          </div>
        </section>
      ) : (
        <Heading
          label="Costco España"
          title={
            path === "/favoritos"
              ? "Tus gasolineras favoritas"
              : "Gasolineras Costco"
          }
          description={
            path === "/favoritos"
              ? "Las estaciones que guardas en este dispositivo."
              : "Precios y ubicaciones en España."
          }
        />
      )}
      <div className="metrics">
        <Metric label="Gasolina 95 más barata" value={least(gas)} />
        <Metric label="Diésel Plus más barato" value={least(diesel)} />
        <Metric label="Media de gasolina 95" value={mean} />
        <Metric
          label="Gasolineras disponibles"
          value={String(stations.length)}
        />
      </div>
      <div className="source-line">
        <span>
          <span className={stale ? "dot stale" : "dot"} />
          {newest
            ? (stale ? "Datos antiguos · " : "Verificado · ") + stamp(newest)
            : "Sin precios verificados todavía"}
        </span>
        <span>
          <TrendingDown size={17} />{" "}
          {
            new Set(
              list.filter((p) => (p.variation ?? 0) < 0).map((p) => p.station),
            ).size
          }{" "}
          con bajadas ·{" "}
          {
            new Set(
              list.filter((p) => (p.variation ?? 0) > 0).map((p) => p.station),
            ).size
          }{" "}
          con subidas
        </span>
      </div>
      {status && (
        <div className="source-line">
          {["telegram", "official"].map((value) => {
            const record = status.data.find((x) => x.source === value);
            const enabled =
              value === "telegram"
                ? status.telegramEnabled
                : status.officialEnabled;
            return (
              <span key={value}>
                {sourceName(value)} ·{" "}
                {enabled
                  ? record?.failures
                    ? "Sincronización retrasada"
                    : record?.last_success
                      ? "Última consulta " + stamp(record.last_success)
                      : "Pendiente de sincronizar"
                  : "Sincronización desactivada"}
              </span>
            );
          })}
        </div>
      )}
      <section id="gasolineras">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Consulta por ubicación</span>
            <h2>
              {path === "/favoritos"
                ? "Estaciones guardadas"
                : "Todas las gasolineras"}
            </h2>
          </div>
          <span>{shown.length} estaciones</span>
        </div>
        <div className="panel filters">
          <Select label="Provincia" value={province} onChange={setProvince}>
            <option value="">Todas</option>
            {[...new Set(stations.map((s) => s.province))].sort().map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
          <Select label="Comunidad" value={region} onChange={setRegion}>
            <option value="">Todas</option>
            {[...new Set(stations.flatMap((s) => (s.region ? [s.region] : [])))]
              .sort()
              .map((p) => (
                <option key={p}>{p}</option>
              ))}
          </Select>
          <Select label="Combustible" value={fuel} onChange={setFuel}>
            <FuelOptions />
          </Select>
          <Select
            label="Fuente para ordenar"
            value={source}
            onChange={setSource}
          >
            <option value="telegram">Socios · Telegram</option>
            <option value="official">Declarado · MITECO</option>
          </Select>
          <Select label="Orden" value={sort} onChange={setSort}>
            <option value="city">Ciudad</option>
            <option value="price">Menor precio</option>
            <option value="expensive">Mayor precio</option>
            <option value="updated">Más recientes</option>
            <option value="lower">Mayor bajada</option>
            <option value="higher">Mayor subida</option>
            {position && <option value="distance">Cercanía</option>}
          </Select>
          <label>
            Máximo €/L
            <input
              type="number"
              min="0"
              step=".001"
              value={max}
              onChange={(e) => setMax(e.target.value)}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={onlyDown}
              onChange={(e) => setOnlyDown(e.target.checked)}
            />{" "}
            Con bajadas
          </label>
          {path !== "/favoritos" && (
            <label className="check">
              <input
                type="checkbox"
                checked={onlyFavorites}
                onChange={(e) => setOnlyFavorites(e.target.checked)}
              />{" "}
              Solo favoritos
            </label>
          )}
          <button
            className="button"
            onClick={() =>
              locate((p) => {
                setPosition(p);
                setSort("distance");
                setGeoError("");
              }, setGeoError)
            }
          >
            <MapPin size={16} /> Cerca de mí
          </button>
        </div>
        {geoError && <p role="status">{geoError}</p>}
        {loading ? (
          <div className="cards">
            <Loading />
            <Loading />
            <Loading />
          </div>
        ) : shown.length ? (
          <div className="cards">
            {shown.map(({ station, km }) => (
              <Card
                key={station.slug}
                station={station}
                prices={prices}
                saved={favorites.includes(station.slug)}
                toggle={toggle}
                km={km}
              />
            ))}
          </div>
        ) : (
          <Empty>
            {stations.length
              ? "Ninguna estación coincide con los filtros."
              : "Las gasolineras aparecerán cuando haya datos de una fuente habilitada."}
          </Empty>
        )}
      </section>
    </>
  );
}
function locate(
  success: (p: GeolocationCoordinates) => void,
  failure: (message: string) => void,
) {
  if (!navigator.geolocation) {
    failure("El navegador no ofrece geolocalización.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (p) => success(p.coords),
    () => failure("No se pudo obtener tu ubicación."),
    { timeout: 7000, maximumAge: 120000 },
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
function Card({
  station,
  prices,
  saved,
  toggle,
  km,
}: {
  station: Station;
  prices: Price[];
  saved: boolean;
  toggle: (s: string) => void;
  km?: number;
}) {
  const rows = prices.filter((p) => p.station === station.slug);
  return (
    <article className="panel station-card">
      <div className="station-heading">
        <div>
          <p>
            <MapPin size={15} /> {station.province}
            {km !== undefined && Number.isFinite(km)
              ? " · " + km.toFixed(1) + " km"
              : ""}
          </p>
          <h3>
            <a href={"/gasolineras/" + station.slug}>{station.name}</a>
          </h3>
        </div>
        <button
          className="icon"
          aria-label={saved ? "Quitar de favoritos" : "Guardar en favoritos"}
          aria-pressed={saved}
          onClick={() => toggle(station.slug)}
        >
          <Heart size={19} fill={saved ? "currentColor" : "none"} />
        </button>
      </div>
      {["telegram", "official"].map((source) => {
        const group = rows.filter((p) => p.source === source);
        return (
          group.length > 0 && (
            <div className="price-group" key={source}>
              <div className="price-source">
                <a href={group[0].source_url}>{sourceName(source)}</a>
                <span title="Última verificación">
                  {stamp(
                    group
                      .map((p) => p.verified_at ?? p.published_at)
                      .sort()
                      .at(-1)!,
                  )}
                </span>
              </div>
              {group.map((p) => (
                <div className="price-row" key={p.fuel}>
                  <div>
                    <strong>{p.fuel_name ?? fuels[p.fuel] ?? p.fuel}</strong>
                    <small>Último cambio · {stamp(p.published_at)}</small>
                  </div>
                  <div className="price-number">
                    <strong>
                      {euros(p.price / 1000)}
                      <small>/L</small>
                    </strong>
                    {p.previous !== null && (
                      <small className={(p.variation ?? 0) < 0 ? "down" : "up"}>
                        {(p.variation ?? 0) < 0 ? (
                          <ArrowDown size={12} />
                        ) : (
                          <ArrowUp size={12} />
                        )}{" "}
                        {p.variation! > 0 ? "+" : ""}
                        {euros((p.variation ?? 0) / 1000)} · antes{" "}
                        {euros(p.previous / 1000)}
                      </small>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        );
      })}
      {!rows.length && <p className="muted">Sin precios verificados.</p>}
      <div className="station-actions">
        <a href={"/historico?station=" + station.slug}>Histórico</a>
        <a href={"/comparador?station=" + station.slug}>Comparar</a>
        <a href={maps(station)} target="_blank" rel="noreferrer">
          Cómo llegar <ArrowRight size={14} />
        </a>
      </div>
    </article>
  );
}
const initialStation = () =>
  new URLSearchParams(location.search).get("station") ?? "";
function History({
  defaultSource,
  stations,
  initial,
}: {
  defaultSource: string;
  stations: Station[];
  initial?: string;
}) {
  const [station, setStation] = useState(initial ?? initialStation()),
    [comparison, setComparison] = useState(""),
    [fuel, setFuel] = useState("gas95"),
    [source, setSource] = useState(defaultSource),
    [days, setDays] = useState("90"),
    [start, setStart] = useState(""),
    [end, setEnd] = useState("");
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
        const ids =
          comparison && comparison !== selected
            ? [selected, comparison]
            : [selected];
        const results = await Promise.all(
          ids.map(async (id) => {
            query.set("station", id);
            const result = await api<Series>(
              "/prices/history?" + query.toString(),
              { signal: controller.signal },
            );
            return [
              id,
              { ...result, data: [...result.data].reverse() },
            ] as const;
          }),
        );
        if (!controller.signal.aborted) setSeries(Object.fromEntries(results));
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [selected, comparison, fuel, source, days, start, end]);
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
      <h2>Evolución del precio</h2>
      <div className="form-grid">
        <Select label="Gasolinera" value={selected} onChange={setStation}>
          <StationOptions stations={stations} />
        </Select>
        <Select
          label="Comparar con"
          value={comparison}
          onChange={setComparison}
        >
          <option value="">Sin segunda estación</option>
          {stations
            .filter((s) => s.slug !== selected)
            .map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
        </Select>
        <Select label="Combustible" value={fuel} onChange={setFuel}>
          <FuelOptions />
        </Select>
        <Select label="Fuente" value={source} onChange={setSource}>
          <option value="telegram">Socios · Telegram</option>
          <option value="official">Declarado · MITECO</option>
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
function Compare({
  stations,
  prices,
}: {
  stations: Station[];
  prices: Price[];
}) {
  const [station, setStation] = useState(initialStation()),
    [fuel, setFuel] = useState("gas95"),
    [radius, setRadius] = useState("10"),
    [liters, setLiters] = useState(50),
    [extra, setExtra] = useState(0),
    [consumption, setConsumption] = useState(6),
    [fills, setFills] = useState(2);
  const selected = station || stations[0]?.slug || "";
  const { data, error, loading } = useNearby(selected, fuel, radius);
  const member = prices.find(
    (p) => p.station === selected && p.fuel === fuel && p.source === "telegram",
  );
  const official = prices.find(
    (p) => p.station === selected && p.fuel === fuel && p.source === "official",
  );
  const reference = member ?? official;
  return (
    <>
      <Heading
        label="Compara antes de salir"
        title="Comparador de gasolineras"
        description="Consulta precios declarados de otras gasolineras y estima el ahorro después del desplazamiento."
      />
      <section className="panel feature">
        <div className="form-grid">
          <Select
            label="Estación Costco"
            value={selected}
            onChange={setStation}
          >
            <StationOptions stations={stations} />
          </Select>
          <Select label="Combustible" value={fuel} onChange={setFuel}>
            <FuelOptions />
          </Select>
          <Select
            label="Radio en línea recta"
            value={radius}
            onChange={setRadius}
          >
            {[5, 10, 20, 50].map((n) => (
              <option value={n} key={n}>
                {n} km
              </option>
            ))}
          </Select>
          <NumberField
            label="Litros por repostaje"
            value={liters}
            change={setLiters}
          />
          <NumberField
            label="Km extra de ida y vuelta"
            value={extra}
            change={setExtra}
          />
          <NumberField
            label="Consumo L/100 km"
            value={consumption}
            change={setConsumption}
          />
          <NumberField
            label="Repostajes mensuales"
            value={fills}
            change={setFills}
          />
        </div>
        <p className="muted">
          {member ? "Socios · " + euros(member.price / 1000) + "/L. " : ""}
          {official
            ? "Declarado para Costco · " + euros(official.price / 1000) + "/L. "
            : ""}
          {member && official
            ? "Diferencia entre modalidades: " +
              euros((official.price - member.price) / 1000) +
              "/L. "
            : ""}
          Hasta cinco precios de MITECO en el radio seleccionado. Las provincias
          se actualizan por turnos.
        </p>
        {loading ? (
          <Loading />
        ) : error ? (
          <Empty>{error}</Empty>
        ) : data.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Gasolinera</th>
                  <th>Distancia recta</th>
                  <th>€/L</th>
                  <th>Diferencia €/L</th>
                  <th>Viaje</th>
                  <th>Ahorro neto</th>
                  <th>Mensual</th>
                  <th>Anual</th>
                </tr>
              </thead>
              <tbody>
                {data.map((p) => {
                  const result = reference
                    ? savings(
                        reference.price / 1000,
                        p.price / 1000,
                        liters,
                        consumption,
                        extra,
                        fills,
                        0,
                      )
                    : null;
                  return (
                    <tr key={p.official_id}>
                      <td>
                        <strong>{p.name}</strong>
                        <small>{p.address}</small>
                        <small>Verificado · {stamp(p.verified_at)}</small>
                      </td>
                      <td>{p.distance.toFixed(1)} km</td>
                      <td>{euros(p.price / 1000)}</td>
                      <td>
                        {reference
                          ? euros((p.price - reference.price) / 1000)
                          : "—"}
                      </td>
                      {[
                        result?.trip,
                        result?.net,
                        result?.monthly,
                        result?.annual,
                      ].map((value, i) => (
                        <td key={i}>
                          {value === undefined ? "—" : euros(value, 2)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>
            No hay precios cercanos disponibles para esta selección.
          </Empty>
        )}
      </section>
    </>
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
function MapPage({
  defaultSource,
  stations,
  prices,
}: {
  defaultSource: string;
  stations: Station[];
  prices: Price[];
}) {
  const [station, setStation] = useState(""),
    [fuel, setFuel] = useState("gas95"),
    [source, setSource] = useState(defaultSource),
    [position, setPosition] = useState<GeolocationCoordinates | null>(null),
    [geoError, setGeoError] = useState("");
  const { data } = useNearby(station, fuel, "10");
  const rows = prices.filter((p) => p.fuel === fuel && p.source === source);
  const cheapest = [...rows].sort((a, b) => a.price - b.price)[0];
  const nearest = position
    ? stations
        .flatMap((s) =>
          s.latitude !== null && s.longitude !== null
            ? [
                {
                  s,
                  km: distance(
                    position.latitude,
                    position.longitude,
                    s.latitude,
                    s.longitude,
                  ),
                },
              ]
            : [],
        )
        .sort((a, b) => a.km - b.km)[0]
    : null;
  return (
    <>
      <Heading
        label="Encuentra tu estación"
        title="Mapa de gasolineras"
        description="Localiza las estaciones Costco y consulta el precio del combustible que utilizas."
      />
      <section className="panel feature">
        <div className="form-grid">
          <Select label="Combustible" value={fuel} onChange={setFuel}>
            <FuelOptions />
          </Select>
          <Select label="Precio Costco" value={source} onChange={setSource}>
            <option value="telegram">Socios</option>
            <option value="official">Declarado</option>
          </Select>
          <Select
            label="Mostrar estaciones cercanas a"
            value={station}
            onChange={setStation}
          >
            <StationOptions stations={stations} />
          </Select>
          <button
            className="button"
            onClick={() => locate(setPosition, setGeoError)}
          >
            <MapPin size={17} /> Encontrar la más cercana
          </button>
        </div>
        {nearest && (
          <p>
            Más cercana ·{" "}
            <a href={"/gasolineras/" + nearest.s.slug}>{nearest.s.name}</a> ·{" "}
            {nearest.km.toFixed(1)} km en línea recta
          </p>
        )}
        {cheapest && (
          <p>
            Más económica ·{" "}
            <a href={"/gasolineras/" + cheapest.station}>
              {stations.find((s) => s.slug === cheapest.station)?.name ??
                cheapest.station}
            </a>{" "}
            · {euros(cheapest.price / 1000)}/L
          </p>
        )}
        {geoError && <p role="status">{geoError}</p>}
        <Suspense fallback={<Loading />}>
          <FuelMap stations={stations} prices={rows} nearby={data} />
        </Suspense>
        <ul className="map-list">
          {stations.map((s) => (
            <li key={s.slug}>
              <a href={maps(s)}>{s.name} · Ver indicaciones</a>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
type Alert = {
  id: string;
  station: string;
  fuel: string;
  kind: string;
  threshold: number | null;
};
const alertKinds: Record<string, string> = {
  lower: "Bajada de precio",
  higher: "Subida de precio",
  threshold: "Por debajo de mi objetivo",
  minimum: "Nuevo mínimo registrado",
};
function Alerts({
  stations,
  pushKey,
}: {
  stations: Station[];
  pushKey: string | null;
}) {
  const [token, setToken] = useState(
      () => localStorage.getItem("push-token") ?? "",
    ),
    [alerts, setAlerts] = useState<Alert[]>([]);
  const [station, setStation] = useState(initialStation()),
    [fuel, setFuel] = useState("gas95"),
    [kind, setKind] = useState("lower"),
    [threshold, setThreshold] = useState(0),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState("");
  const selected = station || stations[0]?.slug || "";
  const request = (method: string, bearer: string, body?: unknown) => ({
    method,
    headers: {
      authorization: "Bearer " + bearer,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  async function load(bearer: string) {
    setAlerts(
      (await api<{ data: Alert[] }>("/alerts", request("GET", bearer))).data,
    );
  }
  useEffect(() => {
    if (token)
      void api<{ data: Alert[] }>("/alerts", request("GET", token))
        .then((r) => setAlerts(r.data))
        .catch((e) => setNotice(e.message));
  }, [token]);
  function run(action: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    void action()
      .catch((e) => setNotice(e.message))
      .finally(() => setBusy(false));
  }
  return (
    <>
      <Heading
        label="Avisos personalizados"
        title="Alertas de precio"
        description="Recibe avisos en este dispositivo cuando cambie el precio para socios."
      />
      <section className="panel feature">
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {!pushKey ? (
          <Empty>El servicio de notificaciones aún no está configurado.</Empty>
        ) : !token ? (
          <>
            <p>
              Al activar los avisos, el navegador te pedirá permiso para recibir
              notificaciones. Puedes desactivarlas desde aquí.
            </p>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (
                    !("serviceWorker" in navigator) ||
                    !("PushManager" in window) ||
                    !("Notification" in window)
                  )
                    throw new Error(
                      "Este navegador no admite Web Push en este contexto.",
                    );
                  if ((await Notification.requestPermission()) !== "granted")
                    throw new Error("El navegador no concedió permiso.");
                  const sw = await navigator.serviceWorker.ready;
                  const sub =
                    (await sw.pushManager.getSubscription()) ??
                    (await sw.pushManager.subscribe({
                      userVisibleOnly: true,
                      applicationServerKey: pushKey,
                    }));
                  const fresh = Array.from(
                    crypto.getRandomValues(new Uint8Array(32)),
                    (x) => x.toString(16).padStart(2, "0"),
                  ).join("");
                  await api(
                    "/push/subscribe",
                    request("POST", fresh, sub.toJSON()),
                  );
                  localStorage.setItem("push-token", fresh);
                  setToken(fresh);
                  setNotice("Notificaciones activadas.");
                })
              }
            >
              <Bell size={18} /> Activar notificaciones
            </button>
          </>
        ) : (
          <>
            <h2>{editing ? "Editar alerta" : "Crear alerta"}</h2>
            <div className="form-grid">
              {!editing && (
                <>
                  <Select
                    label="Gasolinera"
                    value={selected}
                    onChange={setStation}
                  >
                    <StationOptions stations={stations} />
                  </Select>
                  <Select label="Combustible" value={fuel} onChange={setFuel}>
                    <FuelOptions />
                  </Select>
                </>
              )}
              <Select label="Avisarme cuando" value={kind} onChange={setKind}>
                {Object.entries(alertKinds).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </Select>
              {kind === "threshold" && (
                <NumberField
                  label="Precio objetivo €/L"
                  value={threshold}
                  change={setThreshold}
                  step=".001"
                />
              )}
            </div>
            <div className="actions">
              <button
                className="button primary"
                disabled={busy || (!editing && !selected)}
                onClick={() =>
                  run(async () => {
                    await api(
                      editing ? "/alerts/" + editing : "/alerts",
                      request(editing ? "PATCH" : "POST", token, {
                        station: selected,
                        fuel,
                        kind,
                        threshold:
                          kind === "threshold"
                            ? Math.round(threshold * 1000)
                            : null,
                      }),
                    );
                    setEditing("");
                    await load(token);
                    setNotice("Alerta guardada.");
                  })
                }
              >
                Guardar alerta
              </button>
              {editing && (
                <button className="button" onClick={() => setEditing("")}>
                  Cancelar edición
                </button>
              )}
            </div>
            <ul className="alert-list">
              {alerts.map((a) => (
                <li key={a.id}>
                  <span>
                    {stations.find((s) => s.slug === a.station)?.name ??
                      a.station}{" "}
                    · {fuels[a.fuel]} · {alertKinds[a.kind]}
                    {a.threshold ? " · " + euros(a.threshold / 1000) : ""}
                  </span>
                  <div className="actions">
                    <button
                      className="button"
                      onClick={() => {
                        setEditing(a.id);
                        setKind(a.kind);
                        setThreshold((a.threshold ?? 0) / 1000);
                      }}
                    >
                      Editar
                    </button>
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await api(
                            "/alerts/" + a.id,
                            request("DELETE", token),
                          );
                          await load(token);
                        })
                      }
                    >
                      Eliminar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api("/push/unsubscribe", request("POST", token));
                  const reg = await navigator.serviceWorker.getRegistration();
                  await (
                    await reg?.pushManager.getSubscription()
                  )?.unsubscribe();
                  localStorage.removeItem("push-token");
                  setToken("");
                  setAlerts([]);
                  setNotice("Notificaciones desactivadas.");
                })
              }
            >
              Desactivar notificaciones
            </button>
          </>
        )}
      </section>
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
            ["Consultar MITECO", "/admin/sync?source=official", "POST"],
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
                recent_provinces: "Provincias en las últimas 72 h",
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
                  <a href={"https://t.me/costco_gasolineras/" + m.id}>
                    Publicación {m.id}
                  </a>{" "}
                  · {stamp(m.published_at)}
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
              <option value="official">MITECO</option>
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
          Guardamos en el navegador el tema y tus favoritos. Si activas Web
          Push, el servicio guarda la suscripción, las alertas y una sesión
          seudónima durante un máximo de 180 días. Puedes eliminarlos desde
          Alertas.
        </p>
        <p>
          La ubicación se solicita al pulsar un botón y se usa en el dispositivo
          para ordenar las estaciones. El mapa solicita teselas a OpenStreetMap,
          que recibe los datos de conexión necesarios para servirlas.
        </p>
      </>
    ),
    cookies: (
      <p>
        La aplicación usa almacenamiento local para el tema, los favoritos y la
        sesión de avisos. No instala cookies de publicidad ni activa analítica.
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
      <p>
        El correo de contacto del proyecto está pendiente de configurar.
      </p>
    ),
    fuentes: (
      <>
        <ul>
          <li>
            <a href="https://t.me/s/costco_gasolineras">
              Telegram · precios para socios
            </a>
          </li>
          <li>
            <a href="https://datos.gob.es/es/catalogo/e05068001-instalaciones-de-suministro-de-combustibles-a-vehiculos-con-venta-publica">
              MITECO · precios declarados y ubicación de estaciones
            </a>
          </li>
          <li>
            <a href="https://www.openstreetmap.org/copyright">
              OpenStreetMap · cartografía
            </a>
          </li>
        </ul>
        <p>
          Los datos de MITECO se ofrecen bajo <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. El proyecto filtra las estaciones, normaliza los importes y calcula distancias e históricos.
        </p>
        <p>
          Las modalidades de socios y precios declarados se muestran por
          separado. El histórico refleja las publicaciones que hayan podido
          consultarse.
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
