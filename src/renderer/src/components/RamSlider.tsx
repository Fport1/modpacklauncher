interface Props {
  value: number
  onChange: (value: number) => void
  max: number
  min?: number
  step?: number
}

export default function RamSlider({ value, onChange, max, min = 512, step = 512 }: Props) {
  const pct = Math.round(((value - min) / (max - min)) * 100)

  const presets = [1024, 2048, 4096, 8192].filter((p) => p <= max)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(parseInt(e.target.value))}
            className="ram-slider w-full h-2 rounded-full appearance-none cursor-pointer"
            style={
              {
                background: `linear-gradient(to right, #22c55e ${pct}%, #334155 ${pct}%)`
              } as React.CSSProperties
            }
          />
        </div>
        <div className="flex items-center gap-1 bg-bg-primary border border-border rounded-lg px-3 py-1 min-w-[80px]">
          <span className="text-sm font-mono font-semibold text-text-primary">{value}</span>
          <span className="text-xs text-text-muted">MB</span>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-text-muted">{min} MB</span>
        <div className="flex gap-1">
          {presets.map((p) => (
            <button
              key={p}
              onClick={() => onChange(p)}
              className={`text-xs px-2 py-0.5 rounded transition-colors ${
                value === p
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {p >= 1024 ? `${p / 1024}G` : `${p}M`}
            </button>
          ))}
        </div>
        <span className="text-xs text-text-muted">{max} MB</span>
      </div>
    </div>
  )
}
