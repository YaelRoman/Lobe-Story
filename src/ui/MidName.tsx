import { splitTail } from './legend';

/**
 * A file name that is cut in the middle when its row is narrow: the start gets the ellipsis (see `.mid-head`), the
 * end stays whole (`.mid-tail`), so names that differ at the end can be told apart. The full text stays in the DOM.
 */
export function MidName({ text, tail = 11 }: { text: string; tail?: number }) {
  const s = splitTail(text, tail);
  return (
    <>
      <span className="mid-head">{s.head}</span>
      {s.tail && <span className="mid-tail">{s.tail}</span>}
    </>
  );
}
