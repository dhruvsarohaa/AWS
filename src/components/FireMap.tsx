import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Fires } from './ContextPanels.tsx'
export default function FireMap({ evidence }: { evidence: Fires }) {
  const node = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!node.current) return
    const b = evidence.bounds,
      map = L.map(node.current, {
        scrollWheelZoom: false,
        minZoom: 4,
        maxZoom: 12,
        attributionControl: false,
      })
    map.fitBounds([
      [b.south, b.west],
      [b.north, b.east],
    ])
    L.rectangle(
      [
        [b.south, b.west],
        [b.north, b.east],
      ],
      { color: '#56726e', weight: 1, fillOpacity: 0.02 },
    ).addTo(map)
    for (let lat = Math.ceil(b.south * 2) / 2; lat < b.north; lat += 0.5)
      L.polyline(
        [
          [lat, b.west],
          [lat, b.east],
        ],
        { color: '#9aa8a5', weight: 1, dashArray: '3 5' },
      ).addTo(map)
    for (let lon = Math.ceil(b.west * 2) / 2; lon < b.east; lon += 0.5)
      L.polyline(
        [
          [b.south, lon],
          [b.north, lon],
        ],
        { color: '#9aa8a5', weight: 1, dashArray: '3 5' },
      ).addTo(map)
    for (const p of evidence.detections) {
      const text = document.createElement('span')
      text.textContent = `${p.satellite} · ${p.acquiredAt} UTC · ${p.confidence} confidence · ${p.fireRadiativePower} MW`
      L.circleMarker([p.latitude, p.longitude], {
        radius: 5,
        color: p.confidence === 'high' ? '#9a3412' : '#c76b24',
        fillOpacity: 0.8,
      })
        .bindPopup(text)
        .addTo(map)
    }
    return () => {
      map.remove()
    }
  }, [evidence])
  return (
    <div>
      <div
        className="station-map"
        ref={node}
        aria-label="Satellite detection positions. Use the acquisition table below for accessible details."
      />
      <p className="help-text">
        Positions in the queried region; grid lines every 0.5°. No external
        basemap is loaded. Dots are satellite detections, not a continuous fire
        boundary or pollution heatmap. NASA FIRMS / NOAA VIIRS.
      </p>
    </div>
  )
}
