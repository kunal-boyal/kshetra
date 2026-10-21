import { BarChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { type ReactNode, useEffect, useRef, useState } from 'react';

/**
 * Charts on the web (spec 9.1: Apache ECharts, decision D63). Only the parts in use are loaded:
 * bars, axes, the legend and tooltips; pending work is hatched with a decal. Colours come
 * from the design tokens and follow the theme; motion stops under reduced motion. Every chart sits
 * beside a table with the same numbers, as a chart alone is not accessible.
 */
echarts.use([BarChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);

export type ChartOption = echarts.EChartsCoreOption;

/** A design token's value, as chart options need plain colours. */
export function token(name: string): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Whether motion should stop: the system setting, or the person's choice on the root. */
function reducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return (
    document.documentElement.dataset.motion === 'reduce' ||
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  );
}

/** Changes whenever the theme does, so a chart takes its colours again. */
function useThemeVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((value) => value + 1);
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-motion', 'class'],
    });
    const scheme = window.matchMedia?.('(prefers-color-scheme: dark)');
    scheme?.addEventListener('change', bump);
    return () => {
      observer.disconnect();
      scheme?.removeEventListener('change', bump);
    };
  }, []);
  return version;
}

/**
 * A chart, named for screen readers, built from `option` each time the theme changes. `table`
 * holds the same numbers, under a toggle.
 */
export function Chart({
  label,
  option,
  height = 240,
  table,
  tableLabel,
}: {
  label: string;
  /** Builds the chart's options; `token` reads a colour of the current theme. */
  option: (read: typeof token) => ChartOption;
  height?: number;
  table: ReactNode;
  tableLabel: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const theme = useThemeVersion();

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    chart.current = echarts.init(element, null, { renderer: 'svg' });
    // Test browsers lack ResizeObserver; there the chart keeps its first size.
    const resize =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => chart.current?.resize());
    resize?.observe(element);
    return () => {
      resize?.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption({ animation: !reducedMotion(), ...option(token) }, { notMerge: true });
  }, [option, theme]);

  return (
    <div className="flex flex-col gap-2">
      <div ref={box} role="img" aria-label={label} style={{ width: '100%', height }} />
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-[var(--accent)]">
          {tableLabel}
        </summary>
        {table}
      </details>
    </div>
  );
}
