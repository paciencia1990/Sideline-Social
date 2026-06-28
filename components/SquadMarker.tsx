import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors, Typography } from '@/constants/theme';
import { Squad } from '@/services/squadService';

// Sport emoji map
const SPORT_EMOJI: Record<string, string> = {
  Soccer: '⚽',
  Baseball: '⚾',
  Basketball: '🏀',
  Football: '🏈',
  Lacrosse: '🥍',
  Swimming: '🏊',
  Dance: '💃',
  Gymnastics: '🤸',
  Tennis: '🎾',
  TrackAndField: '🏃',
  Volleyball: '🏐',
  Other: '🏅',
};

interface SquadMarkerProps {
  squad: Squad;
  isSelected: boolean;
}

export function SquadMarker({ squad, isSelected }: SquadMarkerProps) {
  const emoji = SPORT_EMOJI[squad.sport] ?? '🏅';

  return (
    <View
      style={styles.wrapper}
      // Prevents constant re-renders on Android which causes jank
      // @ts-ignore — tracksViewChanges is a react-native-maps Marker prop, applied via the parent
    >
      {/* Member count bubble */}
      <View style={[styles.bubble, isSelected && styles.bubbleSelected]}>
        <Text style={styles.bubbleText}>{squad.activeMemberCount}</Text>
      </View>

      {/* Pin body */}
      <View style={[styles.pin, isSelected && styles.pinSelected]}>
        <Text style={styles.emoji}>{emoji}</Text>
      </View>

      {/* Pin tail */}
      <View style={[styles.tail, isSelected && styles.tailSelected]} />
    </View>
  );
}

const PIN_SIZE = 44;
const SELECTED_SCALE = 1.15;

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    width: PIN_SIZE + 16,
  },
  bubble: {
    backgroundColor: Colors.textHeading,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 2,
  },
  bubbleSelected: {
    backgroundColor: Colors.primary,
  },
  bubbleText: {
    fontFamily: Typography.bodyBold,
    fontSize: 10,
    color: '#FFFFFF',
  },
  pin: {
    width: PIN_SIZE,
    height: PIN_SIZE,
    borderRadius: PIN_SIZE / 2,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  pinSelected: {
    width: PIN_SIZE * SELECTED_SCALE,
    height: PIN_SIZE * SELECTED_SCALE,
    borderRadius: (PIN_SIZE * SELECTED_SCALE) / 2,
    borderWidth: 2,
    borderColor: Colors.textHeading,
  },
  emoji: {
    fontSize: 20,
  },
  tail: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: Colors.primary,
    marginTop: -1,
  },
  tailSelected: {
    borderTopColor: Colors.primary,
  },
});