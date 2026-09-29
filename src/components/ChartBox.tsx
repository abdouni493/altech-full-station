import { ReactElement, useEffect, useRef, useState } from 'react';
import { ResponsiveContainer } from 'recharts';

interface ChartBoxProps {
  /** Chart height in pixels. */
  height: number;
  /** A single recharts chart element (AreaChart, BarChart, PieChart, …). */
  children: ReactElement;
  className?: string;
}

/**
 * Renders a recharts chart only once its box has a real width.
 *
 * `<ResponsiveContainer>` starts out at width/height -1 and logs
 *   "The width(-1) and height(-1) of chart should be greater than 0…"
 * until its ResizeObserver reports a size. On a slower machine — or in a panel
 * that mounts before layout settles — that first frame is what floods the
 * console. Measuring the box here first silences the warning and stops a chart
 * from ever laying itself out inside a zero-sized container.
 */
export default function ChartBox({ height, children, className }: ChartBoxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Same value → React bails out, so this does not loop on every observation.
    const measure = () => setWidth(el.clientWidth);
    measure();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={className} style={{ height, width: '100%' }}>
      {width > 0 && (
        <ResponsiveContainer width="100%" height={height}>
          {children}
        </ResponsiveContainer>
      )}
    </div>
  );
}
