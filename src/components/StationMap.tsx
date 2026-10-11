import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { DashboardData, Language, Monitor } from '../types.ts'
import { say } from '../lib/labels.ts'
import { formatTimestamp, timestampState } from '../lib/planner.ts'
/** Public basemap is best effort, on demand; no geocoding, heatmap, GPS marker or offline tiles. */
export default function StationMap({
  data,
  monitors,
  now,
  language,
  onSelect,
}: {
  data: DashboardData
  monitors: Monitor[]
  now: number
  language: Language
  onSelect: (m: Monitor) => void
}) {
  const node = useRef<HTMLDivElement>(null),
    layers = useRef<L.LayerGroup | null>(null),
    [tileFailed, setTileFailed] = useState(false),
    t = useCallback(
      (en: string, hi: string) => say(language, en, hi),
      [language],
    )
  const latitude = Math.round(data.location.latitude * 10) / 10,
    longitude = Math.round(data.location.longitude * 10) / 10
  useEffect(() => {
    if (!node.current) return
    const map = L.map(node.current, {
      minZoom: 5,
      maxZoom: 12,
      scrollWheelZoom: false,
    }).setView([latitude, longitude], 10)
    const tiles = L.tileLayer(
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 12,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
      },
    )
    let active = true
    tiles.on('tileerror', () => {
      if (active) setTileFailed(true)
    })
    tiles.addTo(map)
    layers.current = L.layerGroup().addTo(map)
    return () => {
      active = false
      layers.current = null
      map.remove()
    }
  }, [latitude, longitude])
  useEffect(() => {
    const group = layers.current
    if (!group) return
    group.clearLayers()
    const area = L.circle([latitude, longitude], {
      radius: 7500,
      color: '#517488',
      weight: 2,
      fillOpacity: 0.05,
    }).addTo(group)
    const areaText = document.createElement('span')
    areaText.textContent = t(
      'Selected area rounded to 0.1°; circle is an approximate area cue, not a pollution boundary.',
      'चयनित क्षेत्र 0.1° तक गोल; घेरा केवल क्षेत्र संकेत है, प्रदूषण सीमा नहीं।',
    )
    area.bindTooltip(areaText)
    if (data.forecast?.grid) {
      const grid = L.circleMarker(
        [data.forecast.grid.latitude, data.forecast.grid.longitude],
        { radius: 9, color: '#7d629a', weight: 3, fillOpacity: 0.1 },
      ).addTo(group)
      const text = document.createElement('span')
      text.textContent = t(
        'Regional model grid coordinate (~45 km resolution), not a school sensor.',
        'क्षेत्रीय मॉडल ग्रिड (~45 किमी), स्कूल सेंसर नहीं।',
      )
      grid.bindTooltip(text)
    }
    for (const m of monitors) {
      if (
        !Number.isFinite(m.latitude) ||
        !Number.isFinite(m.longitude) ||
        Math.abs(m.latitude!) > 90 ||
        Math.abs(m.longitude!) > 180
      )
        continue
      const fresh = timestampState(m.observedAt, now) === 'fresh',
        color = fresh ? '#196e62' : '#957028',
        marker = L.circleMarker([m.latitude!, m.longitude!], {
          radius: 8,
          color,
          fillColor: color,
          fillOpacity: 0.8,
          weight: 2,
        }).addTo(group)
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'map-station-button'
      button.textContent = `${m.station} · ${m.source} · ${m.value} ${m.unit} · ${formatTimestamp(m.observedAt, now)} · ${fresh ? t('Recent', 'ताज़ा') : t('Old / unverified', 'पुराना / अप्रमाणित')}`
      button.onclick = () => onSelect(m)
      marker.bindPopup(button)
    }
    return () => {
      group.clearLayers()
    }
  }, [data, monitors, now, t, onSelect, latitude, longitude])
  return (
    <div className="station-map-wrap">
      <div
        ref={node}
        className="station-map"
        aria-label={t(
          'Map of returned stations. Use the station list below for accessible details.',
          'मिले स्टेशनों का मानचित्र। विवरण के लिए नीचे स्टेशन सूची देखें।',
        )}
      />
      {tileFailed && (
        <p role="status" className="coverage-warning">
          {t(
            'Some map tiles could not load. Station locations remain listed below; map availability is not data availability.',
            'कुछ नक्शा चित्र नहीं लोड हुए। नीचे स्टेशन सूची उपलब्ध है; नक्शे की उपलब्धता डेटा की उपलब्धता नहीं है।',
          )}
        </p>
      )}
      <p className="help-text">
        {t(
          'Circles show returned station positions, not pollution across streets. Shaded outline: rounded selected area; purple point: model grid. Old readings are marked separately in the list. Map tiles © OpenStreetMap contributors, best effort with no availability guarantee.',
          'गोल बिंदु स्टेशन हैं, सड़कों का प्रदूषण नहीं। घेरा: चयनित गोल क्षेत्र; बैंगनी: मॉडल ग्रिड। सूची में पुराने मापन अलग हैं। नक्शा © OpenStreetMap, उपलब्धता की गारंटी नहीं।',
        )}
      </p>
    </div>
  )
}
