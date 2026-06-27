import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  Actionsheet,
  ActionsheetContent,
  ActionsheetDragIndicator,
  ActionsheetDragIndicatorWrapper,
  ActionsheetBackdrop,
} from '@/components/ui/actionsheet';
import { Colors, Typography, Spacing, Radius } from '@/constants/theme';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useSquad } from '@/context/SquadContext';

const SPORTS = [
  'Soccer',
  'Baseball',
  'Basketball',
  'Football',
  'Lacrosse',
  'Swimming',
  'Dance',
  'Gymnastics',
  'Tennis',
  'TrackAndField',
  'Volleyball',
  'Other',
];

const SPORT_LABELS: Record<string, string> = {
  Soccer: 'Soccer',
  Baseball: 'Baseball',
  Basketball: 'Basketball',
  Football: 'Football',
  Lacrosse: 'Lacrosse',
  Swimming: 'Swimming',
  Dance: 'Dance',
  Gymnastics: 'Gymnastics',
  Tennis: 'Tennis',
  TrackAndField: 'Track & Field',
  Volleyball: 'Volleyball',
  Other: 'Other',
};

interface CreateSquadSheetProps {
  isOpen: boolean;
  onClose: () => void;
  userCoords: { latitude: number; longitude: number } | null;
  onSquadCreated: (squadId: string) => void;
}

export function CreateSquadSheet({
  isOpen,
  onClose,
  userCoords,
  onSquadCreated,
}: CreateSquadSheetProps) {
  const { t } = useTranslation();
  const { createSquad } = useSquad();

  const [selectedSport, setSelectedSport] = useState('Soccer');
  const [venueName, setVenueName] = useState('');
  const [squadName, setSquadName] = useState('');
  const [useMyLocation, setUseMyLocation] = useState(true);
  const [loading, setLoading] = useState(false);

  // Auto-populate name when sport/venue changes
  useEffect(() => {
    const sportLabel = SPORT_LABELS[selectedSport] ?? selectedSport;
    setSquadName(venueName ? `${sportLabel} Squad — ${venueName}` : `${sportLabel} Squad`);
  }, [selectedSport, venueName]);

  const handleCreate = async () => {
    if (!squadName.trim() || !venueName.trim()) {
      Alert.alert('', 'Please fill in the squad name and venue.');
      return;
    }
    const coords = useMyLocation && userCoords ? userCoords : userCoords;
    if (!coords) {
      Alert.alert('', 'Location not available. Please enable location access.');
      return;
    }

    setLoading(true);
    try {
      const squadId = await createSquad({
        name: squadName.trim(),
        sport: selectedSport,
        venueName: venueName.trim(),
        venueLocation: coords,
      });
      onClose();
      onSquadCreated(squadId);
    } catch {
      Alert.alert('', t('squad.errorCreating'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Actionsheet isOpen={isOpen} onClose={onClose}>
      <ActionsheetBackdrop />
      <ActionsheetContent style={styles.sheet}>
        <ActionsheetDragIndicatorWrapper>
          <ActionsheetDragIndicator />
        </ActionsheetDragIndicatorWrapper>

        <Text style={styles.title}>{t('squad.createTitle')}</Text>

        <ScrollView
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Sport Picker */}
          <Text style={styles.label}>{t('squad.sportLabel')}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sportRow}
          >
            {SPORTS.map((sport) => (
              <TouchableOpacity
                key={sport}
                style={[styles.sportPill, selectedSport === sport && styles.sportPillActive]}
                onPress={() => setSelectedSport(sport)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.sportPillText,
                    selectedSport === sport && styles.sportPillTextActive,
                  ]}
                >
                  {SPORT_LABELS[sport]}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Venue Name */}
          <Text style={styles.label}>{t('squad.venueLabel')}</Text>
          <TextInput
            style={styles.input}
            value={venueName}
            onChangeText={setVenueName}
            placeholder={t('squad.venuePlaceholder')}
            placeholderTextColor={Colors.secondary}
            returnKeyType="next"
          />

          {/* Squad Name */}
          <Text style={styles.label}>{t('squad.squadNameLabel')}</Text>
          <TextInput
            style={styles.input}
            value={squadName}
            onChangeText={setSquadName}
            placeholderTextColor={Colors.secondary}
            returnKeyType="done"
          />

          {/* Use My Location Toggle */}
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>{t('squad.useMyLocation')}</Text>
            <Switch
              value={useMyLocation}
              onValueChange={setUseMyLocation}
              trackColor={{ false: Colors.secondary, true: Colors.primary }}
              thumbColor="#FFFFFF"
              disabled={!userCoords}
            />
          </View>

          {/* Create Button */}
          <PrimaryButton
            title={t('squad.createButton')}
            onPress={handleCreate}
            loading={loading}
            disabled={loading || !squadName.trim() || !venueName.trim()}
            style={styles.createBtn}
          />
        </ScrollView>
      </ActionsheetContent>
    </Actionsheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.xl,
    maxHeight: '85%',
  },
  title: {
    fontFamily: Typography.heading,
    fontSize: 22,
    color: Colors.textHeading,
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },
  scroll: {
    width: '100%',
  },
  label: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.textHeading,
    marginBottom: Spacing.xs,
    marginTop: Spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.secondary,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
    marginBottom: Spacing.xs,
  },
  sportRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    paddingBottom: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  sportPill: {
    borderWidth: 1,
    borderColor: Colors.secondary,
    borderRadius: 20,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    backgroundColor: Colors.background,
  },
  sportPillActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  sportPillText: {
    fontFamily: Typography.bodyMedium,
    fontSize: 13,
    color: Colors.textPrimary,
  },
  sportPillTextActive: {
    color: '#FFFFFF',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.secondary,
    borderBottomWidth: 1,
    borderBottomColor: Colors.secondary,
  },
  toggleLabel: {
    fontFamily: Typography.bodyMedium,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  createBtn: {
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
});