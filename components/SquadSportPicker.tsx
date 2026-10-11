import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { getSquadSportTranslationKey, SQUAD_SPORTS, type SquadSportId } from '@/constants/sports';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';

export function SquadSportPicker({ selected, onChange, disabled = false }: {
  selected: SquadSportId[];
  onChange: (sports: SquadSportId[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.grid}>
      {SQUAD_SPORTS.map((sport) => {
        const checked = selected.includes(sport.id);
        return (
          <TouchableOpacity
            key={sport.id}
            accessibilityLabel={t(getSquadSportTranslationKey(sport.id))}
            accessibilityRole="checkbox"
            accessibilityState={{ checked, disabled }}
            activeOpacity={0.8}
            disabled={disabled}
            onPress={() => onChange(checked ? selected.filter((id) => id !== sport.id) : [...selected, sport.id])}
            style={[styles.option, checked && styles.selected, disabled && styles.disabled]}
          >
            <Text style={styles.emoji}>{sport.emoji}</Text>
            <Text style={styles.label}>{t(getSquadSportTranslationKey(sport.id))}</Text>
            {checked ? <Check color={Colors.accentGreen} size={16} /> : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  option: { alignItems: 'center', borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, flexDirection: 'row', gap: Spacing.xs, minHeight: 48, padding: Spacing.sm, flexGrow: 1, flexBasis: '45%' },
  selected: { backgroundColor: Colors.background, borderColor: Colors.accentGreen },
  disabled: { opacity: 0.6 },
  emoji: { fontSize: 17 },
  label: { color: Colors.textHeading, flex: 1, flexShrink: 1, fontFamily: Typography.bodyMedium, fontSize: 13 },
});
