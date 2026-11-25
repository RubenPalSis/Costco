import {
  CartesianGrid,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { euros, stamp, type Price } from "./data";
export function HistoryChart({ data }: { data: Price[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart
        data={data.map((p) => ({
          date: stamp(p.published_at),
          price: p.price / 1000,
        }))}
      >
        <CartesianGrid strokeDasharray="4 4" opacity={0.25} />
        <XAxis dataKey="date" minTickGap={70} />
        <YAxis domain={["auto", "auto"]} tickFormatter={(v) => euros(v, 2)} />
        <Tooltip
          formatter={(value) => [euros(Number(value)) + "/L", "Precio"]}
        />
        <Line
          type="stepAfter"
          dataKey="price"
          stroke="#168560"
          strokeWidth={3}
          dot={data.length < 10}
        />
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
        <Bar dataKey="cost" fill="#168560" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
