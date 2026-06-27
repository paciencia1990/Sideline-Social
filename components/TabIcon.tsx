import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/theme';

interface TabIconProps {
  Icon: LucideIcon;
  focused: boolean;
  isCenter?: boolean;
}

export function TabIcon({ Icon, focused, isCenter }: TabIconProps) {
  const size = isCenter ? 28 : 22;
  const color = focused ? Colors.primary : Colors.textPrimary;

  if (isCenter && focused) {
    return (
      <View style={styles.centerHighlight}>
        <Icon size={size} color={color} />
      </View>
    );
  }

  return <Icon size={size} color={color} />;
}

const styles = StyleSheet.create({
  centerHighlight: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(199, 70, 59, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});