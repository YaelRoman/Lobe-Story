/** Where a skip link takes the focus: a heading (tabindex -1) of the plot area or the metrics table. */
export const SKIP_TARGETS = { plots: 'cut-plots-heading', table: 'metrics-heading' } as const;

/**
 * "Skip to plots" and "Skip to table": the first Tab stops of the page, visible only while focused. They move the
 * focus to the section's heading (not just the scroll), so the next Tab starts inside the section.
 */
export function SkipLinks() {
  const go = (id: string) => (e: { preventDefault(): void }) => {
    e.preventDefault();
    const target = document.getElementById(id);
    target?.focus();
    target?.scrollIntoView?.({ block: 'start' });
  };
  return (
    <nav className="skip-links" aria-label="Skip links">
      <a href={`#${SKIP_TARGETS.plots}`} onClick={go(SKIP_TARGETS.plots)}>
        Skip to plots
      </a>
      <a href={`#${SKIP_TARGETS.table}`} onClick={go(SKIP_TARGETS.table)}>
        Skip to table
      </a>
    </nav>
  );
}
