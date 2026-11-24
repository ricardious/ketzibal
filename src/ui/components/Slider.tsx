import { useId } from 'react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Muestra marcas en cada paso (slider-discrete). */
  discrete?: boolean;
  format?: (v: number) => string;
  disabled?: boolean;
  onChange: (v: number) => void;
}

/** slider-continuous / slider-discrete */
export function Slider({ label, value, min, max, step = 1, discrete, format = String, disabled, onChange }: SliderProps) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  const ticks = discrete ? Math.round((max - min) / step) + 1 : 0;
  return (
    <div className={`slider ${disabled ? 'slider--disabled' : ''}`}>
      <div className="slider__head">
        <label className="slider__label" htmlFor={id}>{label}</label>
        <output className="slider__value" htmlFor={id}>{format(value)}</output>
      </div>
      <div className="slider__track">
        <div className="slider__rail" />
        <div className="slider__fill" style={{ left: 0, width: `calc(8px + (100% - 16px) * ${pct / 100})` }} />
        {ticks > 0 && ticks <= 24 && (
          <div className="slider__ticks" aria-hidden>
            {Array.from({ length: ticks }, (_, i) => <i key={i} />)}
          </div>
        )}
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    </div>
  );
}

interface RangeSliderProps {
  label: string;
  value: [number, number];
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: [number, number]) => void;
}

/** slider-range */
export function RangeSlider({ label, value, min, max, step = 1, format = String, onChange }: RangeSliderProps) {
  const id = useId();
  const [a, b] = value;
  const pa = ((a - min) / (max - min)) * 100, pb = ((b - min) / (max - min)) * 100;
  return (
    <div className="slider slider--range">
      <div className="slider__head">
        <span className="slider__label" id={id}>{label}</span>
        <span className="slider__value">{format(a)} – {format(b)}</span>
      </div>
      <div className="slider__track">
        <div className="slider__rail" />
        <div className="slider__fill" style={{ left: `${pa}%`, width: `${pb - pa}%` }} />
        <input type="range" aria-labelledby={id} aria-label="Mínimo" min={min} max={max} step={step} value={a}
          onChange={(e) => onChange([Math.min(Number(e.target.value), b), b])} />
        <input type="range" aria-labelledby={id} aria-label="Máximo" min={min} max={max} step={step} value={b}
          onChange={(e) => onChange([a, Math.max(Number(e.target.value), a)])} />
      </div>
    </div>
  );
}
