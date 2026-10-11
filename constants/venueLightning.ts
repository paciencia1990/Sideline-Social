export type VenueEnvironment = 'indoor' | 'outdoor' | 'both';

export type ApprovedVenueLightningSource = {
  id: string;
  venueName: string;
  providerName: string;
  venueIds: readonly string[];
  squadIds: readonly string[];
  environment: VenueEnvironment;
  enabled: boolean;
  url: string;
};

// Owner-reviewed venue links only. Never infer coverage from a sport or venue name.
// New venues/providers require verification before entering this registry.
export const APPROVED_VENUE_LIGHTNING_SOURCES: readonly ApprovedVenueLightningSource[] = [
  {
    id: 'dr-phillips-park',
    venueName: 'Dr Phillips Park',
    providerName: 'Earth Networks',
    venueIds: ['venue_1l4q16f'],
    squadIds: ['venue_1l4q16f__baseball'],
    environment: 'outdoor',
    enabled: true,
    url: 'https://oas.earthnetworks.com/widget/ResOASWidget.html?widgetId=5b327a3e-0349-4fe0-be1a-8e32829ba79e',
  },
];
