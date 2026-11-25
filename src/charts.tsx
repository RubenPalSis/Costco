import {
  CartesianGrid,
  LineChart,
  Legend,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { euros, stamp } from "./data";
export function HistoryChart({
  series,
}: {
  series: {
    id: string;
    name: string;
    points: { time: number; price: number }[];
  }[];
}) {
  const times = new Map<number, Record<string, number>>();
  for (const row of series)
    for (const point of row.points) {
      const entry = times.get(point.time) ?? { time: point.time };
      entry[row.id] = point.price;
      times.set(point.time, entry);
    }
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={[...times.values()].sort((a, b) => a.time - b.time)}>
        <CartesianGrid strokeDasharray="4 4" opacity={0.25} />
        <XAxis
          dataKey="time"
          type="number"
          domain={["dataMin", "dataMax"]}
          minTickGap={70}
          tickFormatter={(value) =>
            new Intl.DateTimeFormat("es-ES", {
              timeZone: "Europe/Madrid",
              day: "numeric",
              month: "short",
            }).format(Number(value))
          }
        />
        <YAxis domain={["auto", "auto"]} tickFormatter={(v) => euros(v, 2)} />
        <Tooltip
          labelFormatter={(value) =>
            stamp(new Date(Number(value)).toISOString())
          }
          formatter={(value, name) => [euros(Number(value)) + "/L", name]}
        />
        <Legend />
        {series.map((row, index) => (
          <Line
            key={row.id}
            name={row.name}
            type="stepAfter"
            dataKey={row.id}
            stroke={index === 0 ? "#005a9c" : "#ba1530"}
            strokeDasharray={index === 0 ? undefined : "6 4"}
            strokeWidth={3}
            connectNulls
            dot={row.points.length < 10}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
export function SavingsChart({
  costco,
  other,
}: {
  costco: number;
  other: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={225}>
      <BarChart
        data={[
          { station: "Costco", cost: costco },
          { station: "Otra estación", cost: other },
        ]}
        margin={{ left: 12, bottom: 10 }}
      >
        <CartesianGrid strokeDasharray="4 4" opacity={0.25} />
        <XAxis dataKey="station" />
        <YAxis tickFormatter={(v) => euros(v, 0)} />
        <Tooltip formatter={(value) => [euros(Number(value), 2), "Coste"]} />
        <Bar dataKey="cost" fill="#005a9c" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
