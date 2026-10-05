/*
 * The frame every onboarding screen is drawn in: words and controls on the
 * left, and on the right a stage for the thing the words are about.
 *
 * One fixed size for all of them, so moving from sign-in through the tour to
 * setup changes what is in the window and never the window.
 */

export const ONBOARDING_HEIGHT = 540

export function Shell({
  children,
  stage,
  corner,
  caption,
}: {
  children: React.ReactNode
  stage: React.ReactNode
  /** Shown in the stage's top right corner, over whatever is on it. */
  corner?: React.ReactNode
  /** A line under the stage's picture, for what the picture cannot say. */
  caption?: React.ReactNode
}) {
  return (
    <div className="flex" style={{ height: ONBOARDING_HEIGHT }}>
      {/* pt-14: the window has no title bar, so the traffic lights sit over
          this column, and the inset keeps the first thing drawn out from
          under them. */}
      <div className="flex w-[380px] shrink-0 flex-col px-7 pt-14 pb-6">{children}</div>

      <div className="relative my-2.5 mr-2.5 flex flex-auto flex-col items-center justify-center gap-5 overflow-hidden rounded-[12px] bg-card">
        {stage}
        {caption ? (
          <p className="m-0 max-w-[300px] text-center text-[11px] leading-[1.45] text-pretty text-secondary">
            {caption}
          </p>
        ) : null}
        {corner ? <div className="absolute top-2.5 right-2.5">{corner}</div> : null}
      </div>
    </div>
  )
}

export const HEADING = 'm-0 text-[20px] leading-[1.2] font-semibold tracking-[-0.01em] text-balance'
export const LEAD = 'mx-0 mt-2 mb-0 text-[12.5px] leading-[1.5] text-pretty text-secondary'
