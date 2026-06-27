import React from 'react';
import { StyleSheet, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Colors, Typography, Radius } from '@/constants/theme';
import { flattenStyle } from '@/utils/flatten-style';

interface OutlineButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  style?: object;
}

export function OutlineButton({ title, onPress, loading, disabled, style }: OutlineButtonProps) {
  return (
    <TouchableOpacity
      style={flattenStyle([styles.button, disabled && styles.disabled, style])}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color={Colors.primary} />
      ) : (
        <Text style={styles.label}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: 'transparent',
    borderRadius: Radius.button,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  label: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.primary,
  },
  disabled: {
    opacity: 0.6,
  },
});