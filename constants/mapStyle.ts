/**
 * Custom Google Maps style for the Squad map.
 * Warm/muted palette using Sideline Squad design tokens.
 * Removes POI clutter, transit noise, and applies a cream-toned land color.
 */

export const SIDELINE_MAP_STYLE = [
  // Land base — Soft Cream
  {
    elementType: 'geometry',
    stylers: [{ color: '#F5EFE6' }],
  },
  // All labels — Charcoal text
  {
    elementType: 'labels.text.fill',
    stylers: [{ color: '#4A4A4A' }],
  },
  {
    elementType: 'labels.text.stroke',
    stylers: [{ color: '#FDFAF6' }],
  },

  // Administrative areas
  {
    featureType: 'administrative',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#D9C4A1' }],
  },
  {
    featureType: 'administrative.land_parcel',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#9E8C78' }],
  },

  // Landscape
  {
    featureType: 'landscape.natural',
    elementType: 'geometry',
    stylers: [{ color: '#EDE4D5' }],
  },
  {
    featureType: 'landscape.man_made',
    elementType: 'geometry.fill',
    stylers: [{ color: '#F0E9DC' }],
  },

  // Points of interest — hide all
  {
    featureType: 'poi',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'geometry.fill',
    stylers: [{ color: '#C8DBC8', visibility: 'on' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'labels',
    stylers: [{ visibility: 'off' }],
  },

  // Roads
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#E8E0D5' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#D9C4A1' }],
  },
  {
    featureType: 'road',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#9E8C78' }],
  },
  {
    featureType: 'road.arterial',
    elementType: 'geometry',
    stylers: [{ color: '#DDD6C8' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#D0C9BA' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#C4B89E' }],
  },
  {
    featureType: 'road.local',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#B0A090' }],
  },

  // Transit — hide all
  {
    featureType: 'transit',
    stylers: [{ visibility: 'off' }],
  },

  // Water — muted blue
  {
    featureType: 'water',
    elementType: 'geometry.fill',
    stylers: [{ color: '#C5D8E8' }],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#2F4156' }],
  },
];