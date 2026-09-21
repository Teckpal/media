'use client'

import { useRef, useState, useTransition } from 'react'
import { ImagePlus, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { registerMediaAction } from '@/lib/posts/media-actions'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import type { MediaItem } from '@/lib/posts/validation'

export type ComposerMedia = MediaItem & {
  previewUrl: string | null
}

const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime'
const MAX_BYTES = 200 * 1024 * 1024

/**
 * Uploads go straight from the browser to Supabase Storage.
 *
 * Not through a server action: a 200MB video would have to be held in memory
 * in a serverless function, and the storage policies in migration 0011 already
 * decide who may write where. Only the metadata comes back to the server, and
 * it re-checks that the object really exists before writing a row.
 */
export function MediaUploader({
  workspaceId,
  media,
  onChange,
  disabled,
}: {
  workspaceId: string
  media: ComposerMedia[]
  onChange: (next: ComposerMedia[]) => void
  disabled?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [uploading, setUploading] = useState(false)

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return
    setError(null)
    setUploading(true)

    const supabase = createClient()
    const added: ComposerMedia[] = []

    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_BYTES) {
          setError(`${file.name} is larger than 200MB.`)
          continue
        }

        const extension = file.name.split('.').pop()?.toLowerCase() ?? 'bin'
        // The workspace id is the first path segment; migration 0011's storage
        // policies read membership straight out of the key.
        const path = `${workspaceId}/${crypto.randomUUID()}.${extension}`

        const { error: uploadError } = await supabase.storage
          .from('post-media')
          .upload(path, file, { contentType: file.type, upsert: false })

        if (uploadError) {
          setError(`Could not upload ${file.name}.`)
          continue
        }

        const dimensions = await measure(file)

        const result = await registerMediaAction({
          storagePath: path,
          mimeType: file.type,
          byteSize: file.size,
          ...dimensions,
        })

        if (!result.ok) {
          setError(result.error)
          continue
        }

        added.push({
          id: result.media.id,
          mimeType: result.media.mimeType,
          width: result.media.width,
          height: result.media.height,
          durationMs: result.media.durationMs,
          previewUrl: result.media.previewUrl,
        })
      }

      if (added.length > 0) {
        startTransition(() => onChange([...media, ...added]))
      }
    } finally {
      setUploading(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="space-y-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {media.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {media.map((item) => (
            <li
              key={item.id}
              className="relative size-24 overflow-hidden rounded-[var(--radius)] border border-border bg-surface-muted"
            >
              {item.previewUrl && item.mimeType.startsWith('image/') ? (
                // A short-lived signed Storage URL, which next/image cannot
                // optimise or cache.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.previewUrl}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                <span className="flex size-full items-center justify-center text-xs text-muted-foreground">
                  {item.mimeType.startsWith('video/') ? 'Video' : 'File'}
                </span>
              )}

              <button
                type="button"
                onClick={() => onChange(media.filter((m) => m.id !== item.id))}
                disabled={disabled}
                className="absolute top-1 right-1 rounded-full bg-background/90 p-1 text-foreground"
              >
                <X className="size-3.5" aria-hidden />
                <span className="sr-only">Remove this file</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled || uploading || pending}
        onClick={() => input.current?.click()}
      >
        <ImagePlus className="size-4" aria-hidden />
        {uploading ? 'Uploading…' : 'Add image or video'}
      </Button>
    </div>
  )
}

/**
 * Measures the file in the browser.
 *
 * Only ever used for the aspect-ratio hint, so a failure is not worth
 * reporting — an unmeasured file is simply not judged on its dimensions.
 */
async function measure(
  file: File,
): Promise<{ width?: number; height?: number; durationMs?: number }> {
  if (file.type.startsWith('image/')) {
    try {
      const bitmap = await createImageBitmap(file)
      const size = { width: bitmap.width, height: bitmap.height }
      bitmap.close()
      return size
    } catch {
      return {}
    }
  }

  if (file.type.startsWith('video/')) {
    return new Promise((resolve) => {
      const video = document.createElement('video')
      const url = URL.createObjectURL(file)

      const done = (out: { width?: number; height?: number; durationMs?: number }) => {
        URL.revokeObjectURL(url)
        resolve(out)
      }

      video.preload = 'metadata'
      video.onloadedmetadata = () =>
        done({
          width: video.videoWidth || undefined,
          height: video.videoHeight || undefined,
          durationMs: Number.isFinite(video.duration)
            ? Math.round(video.duration * 1000)
            : undefined,
        })
      video.onerror = () => done({})
      video.src = url
    })
  }

  return {}
}
