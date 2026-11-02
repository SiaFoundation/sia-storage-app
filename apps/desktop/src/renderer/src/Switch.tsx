/*
 * An on-off switch, drawn as AppKit draws a small NSSwitch: an accent track
 * when on, a white knob that slides across, and a knob that stretches while
 * the pointer is held on it.
 */

export function Switch({
  checked,
  onChange,
  labelledBy,
  describedBy,
  testId,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  labelledBy?: string
  describedBy?: string
  testId?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className={`group relative h-[18px] w-[32px] shrink-0 cursor-default rounded-full border-none p-0 outline-none transition-colors duration-200 ease-settle focus-visible:shadow-[0_0_0_3px_rgb(10_132_255/40%)] ${checked ? 'bg-accent' : 'bg-switch-off'}`}
    >
      {/* Stretched by 3px while pressed. When on, it moves left by the same
          3px, so the stretch grows toward the middle from either end. */}
      <span
        aria-hidden="true"
        className={`absolute top-[2px] left-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.25),0_0_0_0.5px_rgb(0_0_0/0.06)] transition-[translate,width] duration-200 ease-settle group-active:w-[17px] ${checked ? 'translate-x-[14px] group-active:translate-x-[11px]' : ''}`}
      />
    </button>
  )
}
