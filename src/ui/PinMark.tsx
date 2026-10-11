/** The pin that marks the reference file (the text says it for screen readers; the drawing is decoration). */
export function PinMark() {
  return (
    <span className="pin-mark" role="img" aria-label="Reference file" title="Reference file">
      <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" focusable="false">
        <path d="M4 1h4l-.6 3.2L9.5 6.5H6.6V11H5.4V6.5H2.5L4.6 4.2z" fill="currentColor" />
      </svg>
    </span>
  );
}
