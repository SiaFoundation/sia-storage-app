/* The push buttons the window's forms end in. */

const BUTTON =
  'cursor-default rounded-md border px-3 py-[3px] text-[12px] [font-family:inherit] ' +
  'transition-[scale,background-color,filter] duration-150 ease-settle enabled:active:scale-[0.96] ' +
  'focus-visible:shadow-[0_0_0_3px_rgb(10_132_255/40%)] focus-visible:outline-none disabled:opacity-45'

export const PLAIN_BUTTON = `${BUTTON} border-divider bg-card text-label enabled:hover:bg-divider`
export const PRIMARY_BUTTON = `${BUTTON} border-transparent bg-accent text-white enabled:hover:brightness-110`
