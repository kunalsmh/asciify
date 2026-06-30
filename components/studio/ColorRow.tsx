"use client";

export default function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "var(--row-bg)",
        borderRadius: 10,
        height: 36,
        padding: "0 12px",
        marginBottom: 4,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontFamily: "'Inter', sans-serif",
          fontWeight: 500,
          color: "var(--muted)",
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--muted)", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>
          {value}
        </span>
        <label
          style={{
            position: "relative",
            width: 20,
            height: 20,
            borderRadius: "50%",
            overflow: "hidden",
            cursor: "pointer",
            background: value,
          }}
        >
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer", padding: 0 }}
          />
        </label>
      </div>
    </div>
  );
}
