'use client'

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { cn } from '@/lib/utils'
import { GRAINS, type EngagementSeries } from '@/lib/analytics/grain'

/**
 * Views and interactions over time.
 *
 * The two series share an axis on purpose: interactions are a subset of views,
 * so the gap between the lines is the thing worth reading. Giving interactions
 * its own scale would make a 4% engagement rate look like a 90% one.
 *
 * Colours come from the design tokens rather than hex, so the chart follows the
 * app into dark mode without a second palette.
 */

const CONFIG = {
  views: { label: 'Views', color: 'var(--primary)' },
  interactions: { label: 'Interactions', color: 'var(--success)' },
} satisfies ChartConfig

export function EngagementChart({
  series,
  basePath,
}: {
  series: EngagementSeries
  /**
   * Where the tabs point. A string, not a callback: a server component cannot
   * hand a function to a client one, and the tabs are links rather than state
   * so the view survives a reload and can be shared.
   */
  basePath: string
}) {
  return (
    <div className="rounded-[var(--radius)] border border-border bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5">
        <div>
          <h2 className="font-medium">Views and interactions</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {series.unavailable
              ? 'We could not load this just now.'
              : series.points.length === 0
                ? 'Nothing has gone out yet.'
                : `${series.totals.views.toLocaleString()} views · ${series.totals.interactions.toLocaleString()} interactions`}
          </p>
        </div>

        {/* --- the grain tabs --- */}
        <div
          role="tablist"
          aria-label="Group engagement by"
          className="flex rounded-[var(--radius)] border border-border p-0.5"
        >
          {GRAINS.map((grain) => {
            const selected = grain.value === series.grain
            return (
              <a
                key={grain.value}
                href={`${basePath}?by=${grain.value}`}
                role="tab"
                aria-selected={selected}
                className={cn(
                  'rounded-[calc(var(--radius)-2px)] px-3 py-1.5 text-sm transition-colors',
                  selected
                    ? 'bg-primary font-medium text-primary-foreground'
                    : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground',
                )}
              >
                {grain.label}
              </a>
            )
          })}
        </div>
      </div>

      <div className="p-5">
        {series.points.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {series.unavailable
              ? 'This did not load. Refreshing usually fixes it.'
              : 'Once posts have gone out, their views and interactions appear here.'}
          </p>
        ) : (
          <ChartContainer config={CONFIG} className="h-[18rem] w-full">
            <LineChart data={series.points} margin={{ left: 4, right: 12, top: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={10}
                // Long captions are the whole axis on a phone otherwise.
                tickFormatter={(value: string) =>
                  value.length > 12 ? `${value.slice(0, 12)}…` : value
                }
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={44}
                tickFormatter={(value: number) =>
                  value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value)
                }
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Line
                dataKey="views"
                type="monotone"
                stroke="var(--color-views)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                dataKey="interactions"
                type="monotone"
                stroke="var(--color-interactions)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ChartContainer>
        )}
      </div>

      {/*
        Said on the card, not in a comment. Section 11 puts analytics in Phase 2
        and no platform is connected, so these numbers are illustrative — and a
        dashboard that shows invented figures without saying so is the one thing
        an analytics screen must never do.
      */}
      {series.sample && series.points.length > 0 ? (
        <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
          <span className="rounded-[calc(var(--radius)-4px)] bg-warning-subtle px-1.5 py-0.5 font-medium text-foreground">
            Sample
          </span>{' '}
          Illustrative figures against your real posts and dates. Nothing reports
          views yet — that arrives with the platform connections.
        </p>
      ) : null}
    </div>
  )
}
