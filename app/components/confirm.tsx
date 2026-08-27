// app/components/confirm.tsx
// Shared confirmation and single-value prompt dialogs built on the Dialog
// primitive. ConfirmDialog optionally requires typing an exact token (e.g.
// the target's email/name) before the destructive action unlocks; PromptDialog
// replaces window.prompt for inline single-field edits.
'use client'

import { useState } from 'react'
import { Dialog } from './dialog'
import { Button, Field, Input } from './ui'

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  /** When set, the confirm button stays disabled until the user types this exact value (case-insensitive). */
  confirmValue,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  confirmValue?: string
  onConfirm: () => void
  onClose: () => void
}) {
  const [typed, setTyped] = useState('')
  // Fresh input on every open: adjust state during render when `open`
  // transitions (recommended React pattern; avoids setState-in-effect).
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setTyped('')
  }

  const unlocked =
    confirmValue === undefined ||
    confirmValue.trim().length === 0 ||
    typed.trim().toLowerCase() === confirmValue.trim().toLowerCase()

  return (
    <Dialog
      open={open}
      onClose={onClose}
      ariaLabel={title}
      className="w-full max-w-md rounded-xl bg-white p-5 shadow-card-hover"
    >
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{message}</p>
      {confirmValue !== undefined && (
        <Field label={`Type “${confirmValue}” to confirm`} className="mt-3">
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose}>
          {cancelLabel}
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={!unlocked}
          onClick={() => {
            onClose()
            onConfirm()
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  )
}

export function PromptDialog({
  open,
  title,
  label,
  initialValue = '',
  placeholder,
  submitLabel = 'Save',
  required = true,
  inputMode,
  onSubmit,
  onClose,
}: {
  open: boolean
  title: string
  label: string
  initialValue?: string
  placeholder?: string
  submitLabel?: string
  /** When false, an empty submission is allowed (e.g. "clear this value"). */
  required?: boolean
  inputMode?: 'text' | 'numeric'
  /** Receives the trimmed value; empty only when required is false. */
  onSubmit: (value: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(initialValue)
  // Re-seed the field each time the dialog opens for a (possibly different)
  // target: adjust state during render on `open` transitions.
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setValue(initialValue)
  }

  const submit = () => {
    const trimmed = value.trim()
    if (required && !trimmed) return
    onClose()
    onSubmit(trimmed)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      ariaLabel={title}
      className="w-full max-w-md rounded-xl bg-white p-5 shadow-card-hover"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <Field label={label} className="mt-3">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            required={required}
            inputMode={inputMode}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm">
            {submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
