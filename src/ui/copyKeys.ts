/** Whether a key press is Ctrl/Cmd+C with no text selected (a selection keeps the browser's own copy). */
export function copyShortcut(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }, selection: { isCollapsed: boolean } | null = typeof window === 'undefined' ? null : window.getSelection()): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'c' && (selection?.isCollapsed ?? true);
}
