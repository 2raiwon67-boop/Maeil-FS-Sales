import type { NaverMap, NaverMarker } from '@/lib/naver/loader';

/** Keep a margin around the viewport so dots are ready during a short pan.
 * Run on idle/filter changes, never on every drag frame. Search keeps all markers.
 */
export function syncViewportMarkers(
  map: NaverMap,
  markers: NaverMarker[],
  matchesFilter: (marker: NaverMarker) => boolean,
) {
  const bounds = map.getBounds();
  const sw = bounds.getSW();
  const ne = bounds.getNE();
  const latMargin = (ne.lat() - sw.lat()) * 0.25;
  const lngMargin = (ne.lng() - sw.lng()) * 0.25;
  const south = sw.lat() - latMargin;
  const north = ne.lat() + latMargin;
  const west = sw.lng() - lngMargin;
  const east = ne.lng() + lngMargin;

  for (const marker of markers) {
    const position = marker.getPosition();
    const inView = position.lat() >= south && position.lat() <= north
      && position.lng() >= west && position.lng() <= east;
    const nextMap = inView && matchesFilter(marker) ? map : null;
    // setMap even with the same value can do SDK/DOM work.
    if (marker.getMap() !== nextMap) marker.setMap(nextMap);
  }
}

/** Yield between marker batches so input and first paint are not blocked. */
export async function buildInBatches<T>(
  items: T[],
  visit: (item: T) => void,
  cancelled: () => boolean,
) {
  let sliceStart = performance.now();
  for (const item of items) {
    if (cancelled()) return;
    visit(item);
    if (performance.now() - sliceStart >= 6) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      sliceStart = performance.now();
    }
  }
}
