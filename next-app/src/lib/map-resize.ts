/** Coalesce startup, foreground and viewport changes into one map resize. */
export function observeMapSize(
  element: HTMLElement,
  resize: (width: number, height: number) => void,
) {
  let frame = 0;
  let lastWidth = 0;
  let lastHeight = 0;
  let force = true;

  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (!width || !height) return;
      if (!force && width === lastWidth && height === lastHeight) return;
      force = false;
      lastWidth = width;
      lastHeight = height;
      resize(width, height);
    });
  };
  const resume = () => {
    if (document.visibilityState === 'hidden') return;
    force = true;
    schedule();
  };

  const observer = new ResizeObserver(schedule);
  observer.observe(element);
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  window.addEventListener('pageshow', resume);
  document.addEventListener('visibilitychange', resume);
  schedule();

  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
    window.removeEventListener('pageshow', resume);
    document.removeEventListener('visibilitychange', resume);
  };
}
