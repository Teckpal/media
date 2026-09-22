'use client'

import * as React from 'react'
import * as Recharts from 'recharts'
import { cn } from '@/lib/utils'

/**
 * The chart shell: a responsive container, a tooltip and a legend that read
 * their labels and colours from one config object.
 *
 * Adapted from the shadcn/ui chart in two ways that matter here:
 *
 *  1. **No `.dark` selector.** The original resolves per-theme colours by
 *     emitting a `<style>` block scoped to `.dark`. This app has no such class
 *     — `globals.css` switches on `prefers-color-scheme` — so that mechanism
 *     would silently never fire and every dark-mode colour would be the light
 *     one. Colours are set as CSS custom properties on the container instead,
 *     which means a config can point at a design token (`var(--primary)`) and
 *     get the right value in both schemes for free. It also drops a
 *     `dangerouslySetInnerHTML` that was building CSS from string concatenation.
 *
 *  2. **Zero is a value.** The original renders the number behind
 *     `{item.value && …}`, so a series reporting 0 shows a blank where the
 *     figure should be — the one number an analytics tooltip most needs to be
 *     able to say.
 */

export type ChartConfig = Record<
  string,
  {
    label?: React.ReactNode
    icon?: React.ComponentType
    /** Any CSS colour. A `var(--token)` is preferred, so dark mode is free. */
    color?: string
  }
>

const ChartContext = React.createContext<{ config: ChartConfig } | null>(null)

function useChart() {
  const context = React.useContext(ChartContext)
  if (!context) throw new Error('useChart must be used within a <ChartContainer />')
  return context
}

export function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<'div'> & {
  config: ChartConfig
  children: React.ComponentProps<typeof Recharts.ResponsiveContainer>['children']
}) {
  const uniqueId = React.useId()
  const chartId = `chart-${id || uniqueId.replace(/:/g, '')}`

  /** `--color-<key>` for every configured series, resolved by the browser. */
  const colors = React.useMemo(() => {
    const style: Record<string, string> = {}
    for (const [key, item] of Object.entries(config)) {
      if (item.color) style[`--color-${key}`] = item.color
    }
    return style as React.CSSProperties
  }, [config])

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        style={colors}
        className={cn(
          "[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground",
          "[&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/60",
          '[&_.recharts-curve.recharts-tooltip-cursor]:stroke-border',
          '[&_.recharts-layer]:outline-hidden [&_.recharts-surface]:outline-hidden',
          "[&_.recharts-dot[stroke='#fff']]:stroke-transparent",
          'flex justify-center text-xs',
          className,
        )}
        {...props}
      >
        <Recharts.ResponsiveContainer>{children}</Recharts.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
}

export const ChartTooltip = Recharts.Tooltip

type TooltipItem = {
  dataKey?: string | number
  name?: string | number
  value?: number | string
  color?: string
  payload?: Record<string, unknown>
}

export function ChartTooltipContent({
  active,
  payload,
  label,
  className,
  hideLabel = false,
  hideIndicator = false,
  labelFormatter,
  formatter,
  nameKey,
}: {
  active?: boolean
  payload?: TooltipItem[]
  label?: unknown
  className?: string
  hideLabel?: boolean
  hideIndicator?: boolean
  labelFormatter?: (label: unknown) => React.ReactNode
  formatter?: (value: number | string, name: string) => React.ReactNode
  nameKey?: string
}) {
  const { config } = useChart()

  if (!active || !payload?.length) return null

  return (
    <div
      className={cn(
        'grid min-w-[9rem] items-start gap-1.5 rounded-[var(--radius)] border border-border bg-surface px-2.5 py-2 text-xs shadow-lg',
        className,
      )}
    >
      {!hideLabel ? (
        <div className="font-medium">
          {labelFormatter ? labelFormatter(label) : String(label ?? '')}
        </div>
      ) : null}

      <div className="grid gap-1.5">
        {payload.map((item, index) => {
          const key = String(nameKey || item.name || item.dataKey || 'value')
          const itemConfig = config[key]
          const colour = item.color || `var(--color-${key})`

          return (
            <div key={`${key}-${index}`} className="flex w-full items-center gap-2">
              {itemConfig?.icon ? (
                <itemConfig.icon />
              ) : hideIndicator ? null : (
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: colour }}
                />
              )}

              <div className="flex flex-1 items-center justify-between gap-4 leading-none">
                <span className="text-muted-foreground">{itemConfig?.label ?? key}</span>

                {/*
                  `!== undefined`, not truthiness. Zero views is a fact worth
                  printing, and the original hid exactly that number.
                */}
                {item.value !== undefined ? (
                  <span className="font-mono font-medium tabular-nums text-foreground">
                    {formatter
                      ? formatter(item.value, key)
                      : typeof item.value === 'number'
                        ? item.value.toLocaleString()
                        : item.value}
                  </span>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export const ChartLegend = Recharts.Legend

export function ChartLegendContent({
  className,
  payload,
  verticalAlign = 'bottom',
  hideIcon = false,
}: {
  className?: string
  payload?: { value?: string; dataKey?: string | number; color?: string }[]
  verticalAlign?: 'top' | 'bottom' | 'middle'
  hideIcon?: boolean
}) {
  const { config } = useChart()
  if (!payload?.length) return null

  return (
    <div
      className={cn(
        'flex items-center justify-center gap-4',
        verticalAlign === 'top' ? 'pb-3' : 'pt-3',
        className,
      )}
    >
      {payload.map((item) => {
        const key = String(item.dataKey || item.value || 'value')
        const itemConfig = config[key]

        return (
          <div key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {itemConfig?.icon && !hideIcon ? (
              <itemConfig.icon />
            ) : (
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: item.color || `var(--color-${key})` }}
              />
            )}
            {itemConfig?.label ?? key}
          </div>
        )
      })}
    </div>
  )
}
