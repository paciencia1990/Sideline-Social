import type { TextStyle } from 'react-native';

export const Colors = {
  primary: '#C7463B',        // Baseball Red — buttons, CTAs, active states
  background: '#F5EFE6',     // Soft Cream — app background
  surface: '#FDFAF6',        // Warm White — cards, modals
  secondary: '#D9C4A1',      // Warm Sand — borders, dividers
  textPrimary: '#4A4A4A',    // Charcoal — body text
  textHeading: '#2F4156',    // Warm Navy — headers, nav labels
  accentGold: '#E8A84C',     // Soft Gold — achievements, stars, tiers
  accentGreen: '#7A9E82',    // Muted Sage — live status, success states
  communicationLink: '#4F7357', // Dark Sage — accessible communication links on cream
  communicationLinkPressed: '#3F6048', // Deep Sage — pressed communication link state
};

export const Typography = {
  display: 'PlayfairDisplay_700Bold_Italic',
  heading: 'PlayfairDisplay_700Bold',
  bodyRegular: 'Montserrat_400Regular',
  bodyMedium: 'Montserrat_500Medium',
  bodySemiBold: 'Montserrat_600SemiBold',
  bodyBold: 'Montserrat_700Bold',
  accent: 'Caveat_400Regular',
};

export const TeamCodeTypography: TextStyle = {
  fontFamily: Typography.bodyBold,
  fontStyle: 'normal',
  letterSpacing: 3,
  textAlign: 'center',
  textTransform: 'uppercase',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const Radius = {
  card: 14,
  button: 10,
  sm: 8,
};

export const Shadow = {
  card: {
    shadowColor: '#2F4156',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
};
