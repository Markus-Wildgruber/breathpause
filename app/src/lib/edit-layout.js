// edit-layout — where the widened edit-mode window goes, and where the bubble sits in it.
//
// The bubble's window (x, y, w, h: physical px) grows so there's room for the controls
// (`room`, CSS px) plus the bubble at its largest (`maxBubble`). The bubble grows from its
// fixed right edge, like the normal layout, so the growth room goes on the left; whatever the
// monitor edge cuts off there is added on the right instead. Controls go right if they fit
// there, else left.

export function editLayout({ x, y, w, h, monX, monY, monW, monH, sf, sizePx, room, maxBubble, below = 64 }) {
  const r = room * sf;
  const growth = Math.max(0, maxBubble - sizePx) * sf;
  const monRight = monX + monW;
  const roomRight = monRight - (x + w), roomLeft = x - monX;
  const side = roomRight >= r || roomRight >= roomLeft ? 'right' : 'left';
  const wantLeft = growth + (side === 'left' ? r : 0);
  const left = Math.max(monX, x - wantLeft);
  const deficit = wantLeft - (x - left);
  const right = Math.min(monRight, x + w + (side === 'right' ? r : 0) + deficit);
  const height = Math.min(Math.max(h, (maxBubble + below) * sf), monY + monH - y);
  const widthCss = (right - left) / sf;
  return {
    x: left,
    width: right - left,
    height,
    widthCss,
    padLeft: (x - left) / sf,
    side,
    // Largest bubble that still leaves the controls inside the window.
    maxSize: Math.max(sizePx, Math.min(maxBubble, widthCss - room, height / sf - below)),
  };
}

// Bubble's left offset (CSS px) for its current size: keep the right edge where it was,
// but shift inward rather than push the controls (or the bubble) out of the window.
export function editMargin(layout, origSize, size, room) {
  const lo = layout.side === 'left' ? room : 0;
  const hi = layout.widthCss - size - (layout.side === 'right' ? room : 0);
  return Math.min(hi, Math.max(lo, layout.padLeft + origSize - size));
}
