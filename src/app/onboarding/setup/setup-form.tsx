'use client'

import { useActionState, useMemo } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field, describedBy } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'
import { completeSetupAction } from '@/lib/onboarding/actions'
import { EMPTY_FORM_STATE } from '@/lib/forms'
import type { Module } from '@/lib/constants'

/**
 * Section 6.2: posts are stored in UTC and shown in the workspace's zone, so
 * getting this right here decides what "9am" means for every scheduled post.
 * Dhaka leads the list because Bangladesh is the home market (Section 7A).
 */
const COMMON_TIMEZONES = [
  'Asia/Dhaka',
  'Asia/Kolkata',
  'Asia/Karachi',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Kuala_Lumpur',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Australia/Sydney',
  'UTC',
]

export type SetupDefaults = {
  name: string
  timezone: string
  industry: string
  websiteUrl: string
  description: string
  targetAudience: string
  brandVoice: string
}

function Submit({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" disabled={pending}>
      {pending ? 'Saving…' : editing ? 'Save and continue' : 'Continue'}
    </Button>
  )
}

export function SetupForm({
  module,
  defaults,
  editing,
}: {
  module: Module
  defaults: SetupDefaults
  editing: boolean
}) {
  const [state, action] = useActionState(completeSetupAction, EMPTY_FORM_STATE)
  const errors = state.fieldErrors ?? {}
  const isBusiness = module === 'business'

  // The visitor's own zone, in case it is not one of the common ones.
  const timezones = useMemo(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
    const all = new Set(COMMON_TIMEZONES)
    if (detected) all.add(detected)
    if (defaults.timezone) all.add(defaults.timezone)
    return [...all].sort()
  }, [defaults.timezone])

  return (
    <form action={action} className="space-y-5">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <Field
        label={isBusiness ? 'Brand name' : 'Workspace name'}
        htmlFor="name"
        error={errors.name}
      >
        <Input
          id="name"
          name="name"
          defaultValue={defaults.name}
          required
          maxLength={120}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={describedBy('name', { error: errors.name })}
        />
      </Field>

      <Field
        label="Timezone"
        htmlFor="timezone"
        hint="Scheduled times are shown in this zone. Stored in UTC."
        error={errors.timezone}
      >
        <Select
          id="timezone"
          name="timezone"
          defaultValue={defaults.timezone || 'Asia/Dhaka'}
          aria-describedby={describedBy('timezone', {
            error: errors.timezone,
            hint: true,
          })}
        >
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replace(/_/g, ' ')}
            </option>
          ))}
        </Select>
      </Field>

      <div className="space-y-1">
        <p className="text-sm font-medium">About the brand</p>
        <p className="text-sm text-muted-foreground">
          Optional, but this is what the AI Planner writes from later.
        </p>
      </div>

      <Field label="Industry" htmlFor="industry" error={errors.industry}>
        <Input
          id="industry"
          name="industry"
          defaultValue={defaults.industry}
          maxLength={120}
          placeholder="Restaurant, fashion, SaaS…"
        />
      </Field>

      <Field label="Website" htmlFor="websiteUrl" error={errors.websiteUrl}>
        <Input
          id="websiteUrl"
          name="websiteUrl"
          type="url"
          inputMode="url"
          defaultValue={defaults.websiteUrl}
          placeholder="https://"
          aria-invalid={Boolean(errors.websiteUrl)}
          aria-describedby={describedBy('websiteUrl', { error: errors.websiteUrl })}
        />
      </Field>

      <Field label="What you do" htmlFor="description" error={errors.description}>
        <Textarea
          id="description"
          name="description"
          rows={3}
          maxLength={2000}
          defaultValue={defaults.description}
        />
      </Field>

      <Field label="Who you post for" htmlFor="targetAudience" error={errors.targetAudience}>
        <Textarea
          id="targetAudience"
          name="targetAudience"
          rows={2}
          maxLength={1000}
          defaultValue={defaults.targetAudience}
        />
      </Field>

      <Field
        label="Tone of voice"
        htmlFor="brandVoice"
        hint="Warm and casual, or formal and precise?"
        error={errors.brandVoice}
      >
        <Input
          id="brandVoice"
          name="brandVoice"
          maxLength={500}
          defaultValue={defaults.brandVoice}
          aria-describedby={describedBy('brandVoice', {
            error: errors.brandVoice,
            hint: true,
          })}
        />
      </Field>

      <Submit editing={editing} />
    </form>
  )
}
