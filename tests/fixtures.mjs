// Explicitly synthetic fixtures for offline verification. Production imports none of these.
export const place = {
  name: 'Fixture Delhi',
  state: 'Delhi',
  latitude: 28.6139,
  longitude: 77.209,
  detected: false,
}
export const rawForecast = () => ({
  timezone: 'Asia/Kolkata',
  utc_offset_seconds: 19800,
  latitude: 28.6,
  longitude: 77.2,
  hourly_units: { pm2_5: 'μg/m³', pm10: 'μg/m³' },
  hourly: {
    time: ['2030-10-08T08:00', '2030-10-08T09:00', '2030-10-08T10:00'],
    pm2_5: [100, 50, 30],
    pm10: [150, 80, 60],
  },
})
export const sensor = {
  id: 11,
  parameter: { id: 2, name: 'pm25', units: 'µg/m³' },
}
export const location = {
  id: 1,
  name: 'SYNTHETIC TEST STATION',
  locality: 'Delhi',
  coordinates: { latitude: 28.61, longitude: 77.21 },
  country: { code: 'IN' },
  isMobile: false,
  isMonitor: true,
  sensors: [sensor],
  owner: { name: 'Test fixture' },
  provider: { name: 'Test fixture' },
  licenses: [],
}
export const latest = () => ({
  value: 42,
  datetime: { utc: new Date().toISOString() },
  sensorsId: 11,
})
export const hourly = () => ({
  value: 42,
  period: {
    datetimeFrom: { utc: new Date(Date.now() - 3600000).toISOString() },
    datetimeTo: { utc: new Date().toISOString() },
  },
})
export const sharedPlan = {
  name: 'Synthetic plan',
  configured: true,
  threshold: 75,
  ruleMode: 'custom',
  activities: [
    {
      id: 'walk',
      activity: 'Synthetic walk',
      place: 'Test park',
      start: '08:00',
      end: '09:00',
      days: [4],
      flexible: true,
      allowedStart: '07:00',
      allowedEnd: '12:00',
      indoorAvailable: true,
    },
  ],
}
